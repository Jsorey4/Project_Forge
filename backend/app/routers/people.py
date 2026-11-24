"""
@author: Jon Sorey (UI idea ported from Preethi Seereddy's frontend, `origin/frontend-preethi`, People page);
    reviewed by the area owner, Aashwat Singh
@description: One person's overview for the People page dialog: the projects they share with the caller and
    the tasks assigned to them in those projects. The caller sees ONLY projects where both of them are current
    members (checked through require_project_role, SE-NFR-11), so a task or project name from a project the
    caller is not in never leaves the server. When the two people share no project, the answer is the same 404
    as for an id that does not exist, so the endpoint cannot be used to find out whether an account exists.
@traces: SE-FR-16, SE-FR-26, SE-FR-30, SE-NFR-11, UC-19
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import ALL_ROLES, require_project_role
from app.core.security import get_current_user
from app.models.entities import Project, ProjectMember, Task, UserProfile
from app.schemas.dto import PersonOverviewOut, PersonProjectOut, PersonTaskOut, PersonUserOut

router = APIRouter(prefix="/api/people", tags=["people"])

NOT_FOUND = "Person not found"


@router.get("/{user_id}", response_model=PersonOverviewOut)
def person_overview(user_id: str, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)) -> PersonOverviewOut:
    """Projects and assigned tasks of `user_id`, limited to projects the caller is also a member of."""
    target_rows = db.execute(
        select(ProjectMember.project_id, ProjectMember.role).where(ProjectMember.user_id == user_id)
    ).all()
    target_roles = {project_id: role for project_id, role in target_rows}

    shared: list[str] = []
    for project_id in target_roles:
        try:
            require_project_role(db, user.id, project_id, ALL_ROLES)  # the caller's CURRENT membership
        except HTTPException:
            continue
        shared.append(project_id)

    person = db.get(UserProfile, user_id) if shared else None
    if person is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)

    projects = db.execute(select(Project).where(Project.id.in_(shared)).order_by(Project.name)).scalars().all()
    counts = {
        project_id: (int(total), int(done))
        for project_id, total, done in db.execute(
            select(
                Task.project_id,
                func.count(Task.id),
                func.coalesce(func.sum(case((Task.status == "done", 1), else_=0)), 0),
            )
            .where(Task.assignee_id == user_id, Task.project_id.in_(shared))
            .group_by(Task.project_id)
        ).all()
    }
    names = {p.id: p.name for p in projects}
    tasks = db.execute(
        select(Task).where(Task.assignee_id == user_id, Task.project_id.in_(shared)).order_by(Task.due_date, Task.title)
    ).scalars().all()

    return PersonOverviewOut(
        user=PersonUserOut(
            id=person.id,
            username=person.username,
            display_name=person.display_name,
            email=person.email,  # project members already see each other's email on the People page
            avatar_url=person.avatar_url,
        ),
        projects=[
            PersonProjectOut(
                id=p.id,
                name=p.name,
                project_type=p.project_type,
                status=p.status,
                deadline=p.deadline,
                role=target_roles[p.id],
                task_count=counts.get(p.id, (0, 0))[0],
                done_task_count=counts.get(p.id, (0, 0))[1],
                open_task_count=counts.get(p.id, (0, 0))[0] - counts.get(p.id, (0, 0))[1],
            )
            for p in projects
        ],
        tasks=[
            PersonTaskOut(
                id=t.id,
                project_id=t.project_id,
                project_name=names[t.project_id],
                title=t.title,
                status=t.status,
                priority=t.priority,
                due_date=t.due_date,
                completed_at=t.completed_at,
            )
            for t in tasks
        ],
    )
