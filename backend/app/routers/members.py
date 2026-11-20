"""
@author: Aashwat Singh
@description: Who is in a project and what they may do. An owner or manager invites an existing user (by
    username or email); the invitation stays "pending" and changes nothing until the invitee accepts it
    from their own account (or declines it). Owners and managers can see and cancel pending invitations,
    remove members (optionally handing their open tasks to someone else) and change roles. Every action
    re-checks the caller's current role in the database, and a project can never be left without an owner:
    membership changes run one after the other under a per-project lock so two simultaneous requests
    cannot both pass the "is another owner left?" check.
@traces: SE-FR-30, SE-NFR-11, UC-19, UC-20
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.core.database import get_db, utcnow
from app.core.permissions import ALL_ROLES, MANAGERS, OWNER, get_membership, require_project_role
from app.core.realtime import hub
from app.core.security import get_current_user
from app.models.entities import Invitation, Project, ProjectMember, Task, TimeEntry, UserProfile
from app.routers.collaboration import create_notifications, publish_notifications
from app.routers.projects import CARD_PALETTE, list_members, project_member_ids
from app.routers.time_tracking import finish_entry
from app.schemas.dto import InvitationOut, InviteRequest, MemberOut, RemoveMemberResult, RoleChangeRequest, UserBrief

router = APIRouter(prefix="/api/projects/{project_id}/members", tags=["members"])
# The invitee's side (UC-19): see my pending invitations, accept or decline one.
invitations_router = APIRouter(prefix="/api/invitations", tags=["invitations"])

LAST_OWNER = "Project must have at least one owner"
OWNER_ONLY = "Only an owner can grant or remove the owner role"


def _owner_count(db: Session, project_id: str) -> int:
    return int(
        db.execute(
            select(func.count()).select_from(ProjectMember).where(
                ProjectMember.project_id == project_id, ProjectMember.role == OWNER
            )
        ).scalar_one()
    )


def _project(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _lock_project(db: Session, project_id: str) -> Project:
    """Serialises membership changes per project (UC-19, UC-20).

    SELECT ... FOR UPDATE on the project row is the first statement of every role change and removal, so
    two such requests for one project run one after the other. Whatever is read after this call - who the
    caller is, the target's role, how many owners remain - is still true when the change is committed.
    Without it two owners could demote each other at the same instant and leave the project with none.
    """
    project = db.execute(select(Project).where(Project.id == project_id).with_for_update()).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _fresh_membership(db: Session, user_id: str, project_id: str) -> ProjectMember | None:
    """Re-reads a membership from the database (not the session cache) after the project lock is held."""
    return db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def _require_fresh_role(db: Session, user_id: str, project_id: str, allowed: frozenset[str] | set[str]) -> ProjectMember:
    membership = _fresh_membership(db, user_id, project_id)
    if membership is None or membership.role not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return membership


def _member_out(db: Session, project_id: str, user_id: str) -> MemberOut:
    members = list_members(db, project_id, only_user_id=user_id)  # one member, not the whole project
    if not members:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return members[0]


@router.get("", response_model=list[MemberOut])
def get_members(project_id: str, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)) -> list[MemberOut]:
    require_project_role(db, user.id, project_id, ALL_ROLES)
    return list_members(db, project_id)


def _invitation_out(inv: Invitation, project_name: str, inviter: UserProfile | None, invitee: UserProfile) -> InvitationOut:
    return InvitationOut(
        id=inv.id,
        project_id=inv.project_id,
        project_name=project_name,
        role=inv.role,
        status=inv.status,
        invited_by=UserBrief.model_validate(inviter) if inviter else None,
        invitee=UserBrief.model_validate(invitee),
        created_at=inv.created_at,
        responded_at=inv.responded_at,
    )


def _load_invitations(db: Session, where) -> list[InvitationOut]:
    """Invitations with the project, inviter and invitee loaded in one query (no per-row lookups)."""
    inviter = aliased(UserProfile)
    invitee = aliased(UserProfile)
    rows = db.execute(
        select(Invitation, Project.name, inviter, invitee)
        .join(Project, Project.id == Invitation.project_id)
        .join(invitee, invitee.id == Invitation.invitee_id)
        .outerjoin(inviter, inviter.id == Invitation.invited_by)
        .where(where)
        .order_by(Invitation.created_at.desc(), Invitation.id)
    ).all()
    return [_invitation_out(inv, name, by, to) for inv, name, by, to in rows]


@router.post("/invite", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
def invite_member(
    project_id: str, body: InviteRequest, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)
) -> InvitationOut:
    """UC-19: owners / managers invite an existing user by username or email.

    Nothing about the project changes yet: the person gets a pending invitation (and a notification) and
    becomes a member only when they accept it.
    """
    require_project_role(db, user.id, project_id, MANAGERS)
    project = _lock_project(db, project_id)
    caller = _require_fresh_role(db, user.id, project_id, MANAGERS)
    if body.role == OWNER and caller.role != OWNER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=OWNER_ONLY)
    ident = body.identifier.strip().lstrip("@").lower()
    invitee = db.execute(
        select(UserProfile).where(or_(func.lower(UserProfile.username) == ident, func.lower(UserProfile.email) == ident))
    ).scalar_one_or_none()
    if invitee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No ProjectForge user has that username or email")
    if _fresh_membership(db, invitee.id, project_id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That person is already a member of this project")
    pending = db.execute(
        select(Invitation.id).where(Invitation.project_id == project_id, Invitation.invitee_id == invitee.id, Invitation.status == "pending")
    ).first()
    if pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That person already has a pending invitation to this project")
    invitation = Invitation(project_id=project_id, invitee_id=invitee.id, invited_by=user.id, role=body.role, status="pending", created_at=utcnow())
    db.add(invitation)
    db.flush()
    notes = create_notifications(
        db,
        [invitee.id],
        kind="invitation",
        message=f"{user.display_name or user.username} invited you to join “{project.name}” as {body.role}",
        link="/projects",
    )
    try:
        db.commit()
    except IntegrityError:  # a simultaneous identical invitation won the unique index
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That person already has a pending invitation to this project") from None
    publish_notifications(notes)
    hub.publish([invitee.id], "invitation", {"project_id": project_id, "invitation_id": invitation.id})
    return _invitation_out(invitation, project.name, user, invitee)


@router.get("/invitations", response_model=list[InvitationOut])
def list_project_invitations(
    project_id: str, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[InvitationOut]:
    """UC-19: the project's pending invitations (owners and managers)."""
    require_project_role(db, user.id, project_id, MANAGERS)
    return _load_invitations(db, (Invitation.project_id == project_id) & (Invitation.status == "pending"))


@router.delete("/invitations/{invitation_id}", response_model=InvitationOut)
def cancel_invitation(
    project_id: str, invitation_id: str, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)
) -> InvitationOut:
    """UC-19: withdraw a pending invitation (owners and managers of that project only)."""
    require_project_role(db, user.id, project_id, MANAGERS)
    invitation = db.get(Invitation, invitation_id)
    if invitation is None or invitation.project_id != project_id:  # another project's invitation is "not found"
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    if invitation.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This invitation has already been answered")
    invitation.status = "cancelled"
    invitation.responded_at = utcnow()
    db.commit()
    hub.publish([invitation.invitee_id], "invitation", {"project_id": project_id, "invitation_id": invitation.id})
    return _load_invitations(db, Invitation.id == invitation.id)[0]


@invitations_router.get("", response_model=list[InvitationOut])
def my_invitations(user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)) -> list[InvitationOut]:
    """UC-19: invitations waiting for the signed-in person (only ever their own)."""
    return _load_invitations(db, (Invitation.invitee_id == user.id) & (Invitation.status == "pending"))


def _answerable(db: Session, user: UserProfile, invitation_id: str) -> Invitation:
    invitation = db.get(Invitation, invitation_id)
    # Someone else's invitation is reported exactly like one that does not exist.
    if invitation is None or invitation.invitee_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    if invitation.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This invitation has already been answered")
    return invitation


@invitations_router.post("/{invitation_id}/accept", response_model=InvitationOut)
def accept_invitation(invitation_id: str, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)) -> InvitationOut:
    """UC-19: the invitee joins the project with the invited role.

    The invitation is only honoured while the person who sent it is still allowed to grant that role
    (an owner / manager for member and manager; an owner for owner), so a stale invitation cannot be
    used after its sender lost their rights or left the project.
    """
    invitation = _answerable(db, user, invitation_id)
    project_id = invitation.project_id
    project = _lock_project(db, project_id)
    db.refresh(invitation)  # re-read under the project lock
    if invitation.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This invitation has already been answered")
    sender = _fresh_membership(db, invitation.invited_by, project_id) if invitation.invited_by else None
    allowed = {OWNER} if invitation.role == OWNER else MANAGERS
    if sender is None or sender.role not in allowed:
        invitation.status = "cancelled"
        invitation.responded_at = utcnow()
        db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This invitation is no longer valid. Ask for a new one.")
    if _fresh_membership(db, user.id, project_id) is not None:
        invitation.status = "accepted"
        invitation.responded_at = utcnow()
        db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You are already a member of this project")
    next_order = int(db.execute(select(func.coalesce(func.max(ProjectMember.card_order), -1)).where(ProjectMember.user_id == user.id)).scalar_one()) + 1
    db.add(
        ProjectMember(
            project_id=project_id,
            user_id=user.id,
            role=invitation.role,
            card_color=CARD_PALETTE[next_order % len(CARD_PALETTE)],
            card_order=next_order,
            joined_at=utcnow(),
        )
    )
    invitation.status = "accepted"
    invitation.responded_at = utcnow()
    notes = create_notifications(
        db,
        [invitation.invited_by] if invitation.invited_by else [],
        kind="invitation_response",
        message=f"{user.display_name or user.username} accepted your invitation to “{project.name}”",
        project_id=project_id,
        link=f"/people?project={project_id}",
    )
    db.commit()
    publish_notifications(notes)
    hub.publish(project_member_ids(db, project_id), "membership_changed", {"project_id": project_id, "user_id": user.id})
    hub.publish([user.id], "project_created", {"project_id": project_id, "name": project.name})
    return _load_invitations(db, Invitation.id == invitation.id)[0]


@invitations_router.post("/{invitation_id}/decline", response_model=InvitationOut)
def decline_invitation(invitation_id: str, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)) -> InvitationOut:
    """UC-19: the invitee says no; nothing about the project changes."""
    invitation = _answerable(db, user, invitation_id)
    project = db.get(Project, invitation.project_id)
    invitation.status = "declined"
    invitation.responded_at = utcnow()
    notes = create_notifications(
        db,
        [invitation.invited_by] if invitation.invited_by else [],
        kind="invitation_response",
        message=f"{user.display_name or user.username} declined your invitation to “{project.name if project else 'the project'}”",
        project_id=invitation.project_id,
        link=f"/people?project={invitation.project_id}",
    )
    db.commit()
    publish_notifications(notes)
    hub.publish([invitation.invited_by] if invitation.invited_by else [], "invitation", {"project_id": invitation.project_id, "invitation_id": invitation.id})
    return _load_invitations(db, Invitation.id == invitation.id)[0]


@router.delete("/{user_id}", response_model=RemoveMemberResult)
def remove_member(
    project_id: str,
    user_id: str,
    reassign_to_user_id: str | None = Query(None),
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RemoveMemberResult:
    """UC-19: remove a member and atomically reassign (or unassign) their open tasks."""
    leaving_self = user_id == user.id
    allowed = ALL_ROLES if leaving_self else MANAGERS
    require_project_role(db, user.id, project_id, allowed)  # cheap refusal before taking the lock
    project = _lock_project(db, project_id)
    caller = _require_fresh_role(db, user.id, project_id, allowed)
    target = caller if leaving_self else _fresh_membership(db, user_id, project_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    if target.role == OWNER:
        if caller.role != OWNER:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=OWNER_ONLY)
        if _owner_count(db, project_id) <= 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=LAST_OWNER)
    if reassign_to_user_id is not None:
        if reassign_to_user_id == user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a different person to take over the tasks")
        if _fresh_membership(db, reassign_to_user_id, project_id) is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tasks can only be reassigned to a current project member")

    now = utcnow()
    open_task_ids = list(
        db.execute(
            select(Task.id).where(Task.project_id == project_id, Task.assignee_id == user_id, Task.status != "done")
        ).scalars()
    )
    # One UPDATE inside the same transaction as the membership delete: all-or-nothing.
    if open_task_ids:
        db.execute(
            update(Task).where(Task.id.in_(open_task_ids)).values(assignee_id=reassign_to_user_id, updated_at=now)
        )
    # Stop the leaving member's running timer properly, so the hours worked so far are kept (UC-04).
    for entry in db.execute(
        select(TimeEntry).where(TimeEntry.project_id == project_id, TimeEntry.user_id == user_id, TimeEntry.ended_at.is_(None))
    ).scalars():
        finish_entry(entry, now)
    db.delete(target)

    notes = []
    if not leaving_self:
        notes += create_notifications(
            db,
            [user_id],
            kind="member_removed",
            message=f"You were removed from “{project.name}”",
            link="/projects",
        )
    if reassign_to_user_id and open_task_ids and reassign_to_user_id != user.id:
        notes += create_notifications(
            db,
            [reassign_to_user_id],
            kind="task_reassigned",
            message=f"{len(open_task_ids)} task(s) in “{project.name}” were reassigned to you",
            project_id=project_id,
            link=f"/board?project={project_id}",
        )
    db.commit()
    publish_notifications(notes)
    recipients = project_member_ids(db, project_id) + [user_id]
    hub.publish(recipients, "membership_changed", {"project_id": project_id, "user_id": user_id})
    if open_task_ids:
        hub.publish(project_member_ids(db, project_id), "task_changed", {"project_id": project_id, "task_id": None, "action": "reassigned"})
    return RemoveMemberResult(
        removed_user_id=user_id,
        reassigned_task_count=len(open_task_ids) if reassign_to_user_id else 0,
        reassigned_to=reassign_to_user_id,
    )


@router.patch("/{user_id}/role", response_model=MemberOut)
def change_role(
    project_id: str,
    user_id: str,
    body: RoleChangeRequest,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MemberOut:
    """UC-20: change a member's role; the last owner can never be demoted (SE-NFR-11).

    The owner count is read after _lock_project(), inside the same transaction that writes the new role,
    so concurrent requests cannot both pass the "is another owner left?" check.
    """
    require_project_role(db, user.id, project_id, MANAGERS)  # cheap refusal before taking the lock
    project = _lock_project(db, project_id)
    caller = _require_fresh_role(db, user.id, project_id, MANAGERS)
    target = caller if user_id == user.id else _fresh_membership(db, user_id, project_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    if body.role == target.role:
        return _member_out(db, project_id, user_id)
    # Authorization before the invariant: a manager is refused (403) for touching the owner role at all, so the
    # response never reveals whether the project has a single owner. Only an owner reaches the last-owner check.
    if (target.role == OWNER or body.role == OWNER) and caller.role != OWNER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=OWNER_ONLY)
    if target.role == OWNER and body.role != OWNER and _owner_count(db, project_id) <= 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=LAST_OWNER)
    previous = target.role
    target.role = body.role
    notes = []
    if user_id != user.id:
        notes = create_notifications(
            db,
            [user_id],
            kind="role_change",
            message=f"Your role in “{project.name}” changed from {previous} to {body.role}",
            project_id=project_id,
            link=f"/projects/{project_id}",
        )
    db.commit()
    publish_notifications(notes)
    hub.publish(project_member_ids(db, project_id), "membership_changed", {"project_id": project_id, "user_id": user_id, "role": body.role})
    return _member_out(db, project_id, user_id)
