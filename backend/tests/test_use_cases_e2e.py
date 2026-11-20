"""
@author: Aashwat Singh (invitations, reminders, seed); Tyler Gaines (sign-up / 2FA); Saaqib Shaik (projects)
@description: End-to-end tests for the use cases that were completed in the "20 use cases" pass: the sign-up
    confirmation and the always-on second sign-in step (UC-08, UC-09), project members given by username or
    email (UC-12), pending invitations that the invitee accepts or declines (UC-19), the deadline-reminder
    job and its manual trigger (UC-22), un-hiding a dashboard widget (UC-16), and the four documented test
    accounts with their populated and empty projects (role checks, real .ics and .xlsx files, "nothing to
    export"). Each test name carries the use-case and requirement ids it verifies.
@traces: SE-FR-11, SE-FR-16, SE-FR-19, SE-FR-20, SE-FR-23, SE-FR-29, SE-FR-30, SE-NFR-02, SE-NFR-11, SE-NFR-12,
    UC-01, UC-08, UC-09, UC-12, UC-14, UC-15, UC-16, UC-19, UC-22
"""

from __future__ import annotations

import dataclasses
import io
import zipfile

import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select

from tests.test_all_requirements import (  # noqa: F401  (client and _reset_limits are pytest fixtures)
    DEMO_PASSWORD,
    H,
    _reset_limits,
    client,
    future,
    iso,
    make_user,
    new_project,
    new_task,
    user_id,
)

import app.routers.auth as auth_module
import app.routers.collaboration as collab_module
from app.core.database import SessionLocal, utcnow
from app.core.security import auth_rate_limiter
from app.models.entities import Invitation, Notification, ProjectMember, UserProfile
from app.routers.collaboration import run_deadline_reminders
from app.seed import EMPTY_PROJECT, POPULATED_PROJECT, TEST_ACCOUNTS

DEMO_CODE = "123456"


def ensure_user(username: str) -> str:
    with SessionLocal() as db:
        existing = db.execute(select(UserProfile.id).where(UserProfile.username == username)).scalar_one_or_none()
    return existing or make_user(username)


_account_tokens: dict[str, str] = {}


def account_headers(client, email: str) -> dict[str, str]:
    """Signs in an account that has 2FA (log-in, then the 6-digit code) and returns its Bearer header."""
    if email not in _account_tokens:
        auth_rate_limiter.reset()
        first = client.post("/api/auth/login", json={"email": email, "password": DEMO_PASSWORD}).json()
        assert first["mfa_required"] is True and first["access_token"] is None, email
        second = client.post("/api/auth/verify-mfa", json={"temp_token": first["temp_token"], "code": DEMO_CODE})
        assert second.status_code == 200, second.text
        _account_tokens[email] = second.json()["access_token"]
    return {"Authorization": f"Bearer {_account_tokens[email]}"}


def project_named(client, headers, name: str) -> dict:
    return next(p for p in client.get("/api/projects", headers=headers).json() if p["name"] == name)


# ---------------------------------------------------------------------------
# UC-08 / UC-09
# ---------------------------------------------------------------------------
def test_uc08_signup_confirms_and_redirects_to_login_without_starting_a_session_se_fr11(client):
    r = client.post("/api/auth/signup", json={"username": "newbie_one", "email": "newbie_one@example.com", "password": "Str0ng!Pass", "display_name": "New Bie"})
    assert r.status_code == 201
    body = r.json()
    assert set(body) == {"message", "user", "redirect_to"} and body["redirect_to"] == "/login"
    assert body["user"]["username"] == "newbie_one" and "email" not in body["user"] and "password" not in r.text
    # The default profile and no project role: nothing but their own empty workspace.
    with SessionLocal() as db:
        row = db.execute(select(UserProfile).where(UserProfile.username == "newbie_one")).scalar_one()
        assert row.theme == "dark" and row.default_project_type == "work" and row.password_hash.startswith("$2")
        assert db.execute(select(func.count()).select_from(ProjectMember).where(ProjectMember.user_id == row.id)).scalar_one() == 0
    # Field errors for each problem, uniqueness case-insensitive, and the rate limit says "try again later".
    for payload, fields in (
        ({"username": "x", "email": "bad", "password": "short"}, {"username", "email", "password"}),
        ({"username": "NEWBIE_ONE", "email": "other@example.com", "password": "Str0ng!Pass"}, {"username"}),
        ({"username": "another_one", "email": "NewBie_One@Example.com", "password": "Str0ng!Pass"}, {"email"}),
        ({"username": "another_one", "email": "a@example.com", "password": "alllowercase1!"}, {"password"}),
    ):
        err = client.post("/api/auth/signup", json=payload)
        assert err.status_code == 422 and fields <= set(err.json()["errors"]), payload
    auth_rate_limiter.reset()
    for i in range(5):
        client.post("/api/auth/signup", json={"username": f"rl_user_{i}", "email": f"rl{i}@example.com", "password": "Str0ng!Pass"})
    limited = client.post("/api/auth/signup", json={"username": "rl_user_x", "email": "rlx@example.com", "password": "Str0ng!Pass"})
    assert limited.status_code == 429 and limited.json() == {"detail": "Try again later"}


def test_uc09_every_login_needs_the_second_step_and_a_locked_account_is_refused_first_se_fr11(client, monkeypatch):
    ensure_user("mfa_everyone")
    monkeypatch.setattr(auth_module, "settings", dataclasses.replace(auth_module.settings, require_mfa=True))
    first = client.post("/api/auth/login", json={"email": "mfa_everyone", "password": DEMO_PASSWORD}).json()
    # The password alone opens nothing: only a short-lived second-step token comes back.
    assert first["mfa_required"] is True and first["access_token"] is None and first["user"] is None and first["temp_token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {first['temp_token']}"}).status_code == 401
    wrong = client.post("/api/auth/verify-mfa", json={"temp_token": first["temp_token"], "code": "000000"})
    assert wrong.status_code == 401 and wrong.json()["detail"] == "Invalid verification code"
    assert client.post("/api/auth/verify-mfa", json={"temp_token": first["temp_token"], "code": "12345"}).status_code == 422  # not 6 digits
    done = client.post("/api/auth/verify-mfa", json={"temp_token": first["temp_token"], "code": DEMO_CODE})
    assert done.status_code == 200 and done.json()["access_token"] and done.json()["user"]["username"] == "mfa_everyone"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {done.json()['access_token']}"})
    assert me.status_code == 200 and me.json()["username"] == "mfa_everyone"
    with SessionLocal() as db:  # the successful sign-in reset the failure counter
        assert db.execute(select(UserProfile.failed_login_attempts).where(UserProfile.username == "mfa_everyone")).scalar_one() == 0
    # Wrong passwords count; five lock the account; the lock is checked before the (correct) password.
    monkeypatch.setattr(auth_rate_limiter, "limit", 1000)
    codes = [client.post("/api/auth/login", json={"email": "mfa_everyone", "password": "wrong-password"}).status_code for _ in range(5)]
    assert codes == [401] * 5
    locked = client.post("/api/auth/login", json={"email": "mfa_everyone", "password": DEMO_PASSWORD})
    assert locked.status_code == 423 and "locked" in locked.json()["detail"]
    assert client.post("/api/auth/login", json={"email": "mfa_everyone@example.com", "password": "wrong"}).status_code == 423  # same account by email
    # Unknown accounts get the same generic error as wrong passwords (no enumeration).
    assert client.post("/api/auth/login", json={"email": "ghost_nobody", "password": "x"}).json()["detail"] == "Invalid email or password"


def test_uc09_seeded_test_accounts_sign_in_with_email_password_and_the_demo_code(client):
    assert {a[1] for a in TEST_ACCOUNTS} == {"owner@projectforge.dev", "manager@projectforge.dev", "member@projectforge.dev", "outsider@projectforge.dev"}
    for _username, email, display, _purpose in TEST_ACCOUNTS:
        headers = account_headers(client, email)
        me = client.get("/api/auth/me", headers=headers).json()
        assert me["email"] == email and me["display_name"] == display and me["mfa_enabled"] is True


# ---------------------------------------------------------------------------
# UC-12
# ---------------------------------------------------------------------------
def test_uc12_members_can_be_listed_by_username_or_email_and_unknown_ones_are_flagged_se_nfr09(client):
    ensure_user("by_mail")
    body = {"name": "Mixed members", "status": "active", "project_type": "school", "deadline": iso(future(20))}
    unknown = client.post("/api/projects", headers=H(client, "jon"), json={**body, "members": ["staff", "BY_MAIL@example.com", "ghost@nowhere.example", "@no_such_user", "jon@example.com", "jon"]})
    assert unknown.status_code == 400 and unknown.json()["unknown_members"] == ["ghost@nowhere.example", "no_such_user"]
    with SessionLocal() as db:  # nothing was saved for the failed attempt
        assert db.execute(select(func.count()).select_from(UserProfile)).scalar_one() > 0
    ok = client.post("/api/projects", headers=H(client, "jon"), json={**body, "members": ["staff", "BY_MAIL@example.com", "by_mail", "jon@example.com"]})
    assert ok.status_code == 201
    project = ok.json()
    assert project["my_role"] == "owner" and project["member_count"] == 3  # jon (owner), staff, by_mail: no duplicates, creator not re-added
    assert {m["username"]: m["role"] for m in project["members"]} == {"jon": "owner", "staff": "member", "by_mail": "member"}
    # Required fields and a future deadline are validated; the type is one of work / school / personal.
    assert client.post("/api/projects", headers=H(client, "jon"), json={**body, "name": "   "}).status_code == 422
    assert client.post("/api/projects", headers=H(client, "jon"), json={**body, "deadline": iso(future(-1))}).json()["errors"]["deadline"] == "Deadline must be in the future"
    assert client.post("/api/projects", headers=H(client, "jon"), json={**body, "project_type": "hobby"}).status_code == 422
    assert client.post("/api/projects", headers=H(client, "jon"), json={**body, "members": ["x" * 255]}).status_code == 422


# ---------------------------------------------------------------------------
# UC-19 / UC-20
# ---------------------------------------------------------------------------
def test_uc19_invitations_are_pending_until_the_invitee_accepts_and_every_step_is_authorized_se_nfr11(client):
    ensure_user("inv_guest")
    project = new_project(client, owner="jon", members=["tyler", "staff"], name="Invitations")
    other = new_project(client, owner="tyler", name="Invitations elsewhere")
    pid = project["id"]
    assert client.patch(f"/api/projects/{pid}/members/{user_id('tyler')}/role", headers=H(client, "jon"), json={"role": "manager"}).status_code == 200
    guest = H(client, "inv_guest")
    invite_url = f"/api/projects/{pid}/members/invite"

    # Who may invite: owners and managers only; only an owner may invite an owner.
    assert client.post(invite_url, headers=H(client, "staff"), json={"identifier": "inv_guest"}).status_code == 403
    assert client.post(invite_url, headers=guest, json={"identifier": "inv_guest"}).status_code == 403
    assert client.post(invite_url, headers=H(client, "tyler"), json={"identifier": "inv_guest", "role": "owner"}).status_code == 403
    assert client.post(invite_url, headers=H(client, "tyler"), json={"identifier": "nobody_at_all"}).status_code == 404
    assert client.post(invite_url, headers=H(client, "tyler"), json={"identifier": "staff"}).status_code == 409  # already a member

    created = client.post(invite_url, headers=H(client, "tyler"), json={"identifier": "INV_GUEST@example.com", "role": "member"})
    assert created.status_code == 201
    invitation = created.json()
    assert invitation["status"] == "pending" and invitation["role"] == "member" and invitation["invitee"]["username"] == "inv_guest"
    assert invitation["invited_by"]["username"] == "tyler" and invitation["project_name"] == "Invitations"
    assert client.post(invite_url, headers=H(client, "jon"), json={"identifier": "inv_guest"}).status_code == 409  # one open invitation each
    # Nothing about the project changed, and the guest still has no access.
    assert client.get(f"/api/projects/{pid}", headers=guest).status_code == 403
    with SessionLocal() as db:
        assert db.execute(select(func.count()).select_from(ProjectMember).where(ProjectMember.project_id == pid)).scalar_one() == 3

    # The guest sees exactly their own pending invitation (and a notification); others do not.
    mine = client.get("/api/invitations", headers=guest).json()
    assert [i["id"] for i in mine] == [invitation["id"]] and client.get("/api/invitations", headers=H(client, "staff")).json() == []
    assert any(n["kind"] == "invitation" and "Invitations" in n["message"] for n in client.get("/api/notifications", headers=guest).json()["items"])
    # Owners / managers see the project's pending list; members do not; another project's id is "not found".
    listed = client.get(f"/api/projects/{pid}/members/invitations", headers=H(client, "jon"))
    assert listed.status_code == 200 and [i["id"] for i in listed.json()] == [invitation["id"]]
    assert client.get(f"/api/projects/{pid}/members/invitations", headers=H(client, "staff")).status_code == 403
    # An invitation id sent through a different project's URL: "not found" for that project's owner (tyler owns
    # "other"), and forbidden for someone who is not in that project at all.
    assert client.delete(f"/api/projects/{other['id']}/members/invitations/{invitation['id']}", headers=H(client, "tyler")).status_code == 404
    assert client.delete(f"/api/projects/{other['id']}/members/invitations/{invitation['id']}", headers=H(client, "jon")).status_code == 403
    # Only the invitee can answer; anyone else gets "not found", and nothing changes.
    for outsider in ("jon", "tyler", "staff"):
        assert client.post(f"/api/invitations/{invitation['id']}/accept", headers=H(client, outsider)).status_code == 404
        assert client.post(f"/api/invitations/{invitation['id']}/decline", headers=H(client, outsider)).status_code == 404
    assert client.post("/api/invitations/not-a-uuid/accept", headers=guest).status_code == 404
    assert client.post(f"/api/invitations/{invitation['id']}/accept", headers={"Authorization": "Bearer nope"}).status_code == 401

    accepted = client.post(f"/api/invitations/{invitation['id']}/accept", headers=guest)
    assert accepted.status_code == 200 and accepted.json()["status"] == "accepted" and accepted.json()["responded_at"]
    assert client.get(f"/api/projects/{pid}", headers=guest).status_code == 200  # access from the very next request
    joined = next(m for m in client.get(f"/api/projects/{pid}/members", headers=guest).json() if m["username"] == "inv_guest")
    assert joined["role"] == "member"
    assert client.post(f"/api/projects/{pid}/tasks", headers=guest, json={"title": "x", "due_date": iso(future(3))}).status_code == 403  # member rules apply
    assert client.post(f"/api/invitations/{invitation['id']}/accept", headers=guest).status_code == 409  # answered once
    assert client.get("/api/invitations", headers=guest).json() == []
    assert any(n["kind"] == "invitation_response" and "accepted" in n["message"] for n in client.get("/api/notifications", headers=H(client, "tyler")).json()["items"])
    assert client.get(f"/api/projects/{pid}/members/invitations", headers=H(client, "jon")).json() == []


def test_uc19_decline_cancel_and_stale_invitations_never_create_a_membership_uc20(client):
    for name in ("inv_a", "inv_b", "inv_c"):
        ensure_user(name)
    project = new_project(client, owner="jon", members=["tyler"], name="Invitation outcomes")
    pid = project["id"]
    assert client.patch(f"/api/projects/{pid}/members/{user_id('tyler')}/role", headers=H(client, "jon"), json={"role": "manager"}).status_code == 200
    url = f"/api/projects/{pid}/members/invite"

    declined = client.post(url, headers=H(client, "jon"), json={"identifier": "inv_a"}).json()
    assert client.post(f"/api/invitations/{declined['id']}/decline", headers=H(client, "inv_a")).json()["status"] == "declined"
    assert client.get(f"/api/projects/{pid}", headers=H(client, "inv_a")).status_code == 403
    assert client.post(f"/api/invitations/{declined['id']}/accept", headers=H(client, "inv_a")).status_code == 409  # cannot reuse an answered one
    again = client.post(url, headers=H(client, "jon"), json={"identifier": "inv_a"})  # a declined person can be invited again
    assert again.status_code == 201

    cancelled = client.post(url, headers=H(client, "jon"), json={"identifier": "inv_b"}).json()
    assert client.delete(f"/api/projects/{pid}/members/invitations/{cancelled['id']}", headers=H(client, "staff")).status_code == 403
    assert client.delete(f"/api/projects/{pid}/members/invitations/{cancelled['id']}", headers=H(client, "tyler")).json()["status"] == "cancelled"
    assert client.post(f"/api/invitations/{cancelled['id']}/accept", headers=H(client, "inv_b")).status_code == 409
    assert client.delete(f"/api/projects/{pid}/members/invitations/{cancelled['id']}", headers=H(client, "tyler")).status_code == 409

    # Tyler invites inv_c, then loses the manager role: the invitation is no longer honoured.
    stale = client.post(url, headers=H(client, "tyler"), json={"identifier": "inv_c"}).json()
    assert client.patch(f"/api/projects/{pid}/members/{user_id('tyler')}/role", headers=H(client, "jon"), json={"role": "member"}).status_code == 200
    refused = client.post(f"/api/invitations/{stale['id']}/accept", headers=H(client, "inv_c"))
    assert refused.status_code == 409 and "no longer valid" in refused.json()["detail"]
    assert client.get(f"/api/projects/{pid}", headers=H(client, "inv_c")).status_code == 403
    with SessionLocal() as db:
        statuses = dict(db.execute(select(Invitation.id, Invitation.status).where(Invitation.project_id == pid)).all())
        assert statuses[stale["id"]] == "cancelled" and statuses[cancelled["id"]] == "cancelled" and statuses[declined["id"]] == "declined"
        assert db.execute(select(func.count()).select_from(ProjectMember).where(ProjectMember.project_id == pid)).scalar_one() == 2  # jon + tyler only

    # An invitation to become owner needs an owner to send it, and the new owner counts for the last-owner rule.
    owner_invite = client.post(url, headers=H(client, "jon"), json={"identifier": "inv_c", "role": "owner"}).json()
    assert client.post(f"/api/invitations/{owner_invite['id']}/accept", headers=H(client, "inv_c")).json()["status"] == "accepted"
    assert client.get(f"/api/projects/{pid}/members", headers=H(client, "inv_c")).status_code == 200
    assert client.patch(f"/api/projects/{pid}/members/{user_id('jon')}/role", headers=H(client, "inv_c"), json={"role": "member"}).status_code == 200  # two owners: allowed
    assert client.patch(f"/api/projects/{pid}/members/{user_id('inv_c')}/role", headers=H(client, "inv_c"), json={"role": "member"}).status_code == 400  # last owner


def test_uc20_a_manager_is_refused_403_before_the_last_owner_rule_is_even_checked_se_nfr11(client):
    """Found by the live browser run: a manager demoting the sole owner got 400 "last owner" (which also revealed
    that there is a single owner) instead of 403. Authorization is checked first; only an owner reaches the invariant."""
    project = new_project(client, owner="jon", members=["tyler"], name="Owner role is owner-only")
    pid, url = project["id"], f"/api/projects/{project['id']}/members"
    assert client.patch(f"{url}/{user_id('tyler')}/role", headers=H(client, "jon"), json={"role": "manager"}).status_code == 200

    sole_owner = f"{url}/{user_id('jon')}/role"
    refused = client.patch(sole_owner, headers=H(client, "tyler"), json={"role": "member"})  # manager -> owner
    assert refused.status_code == 403 and "owner" in refused.json()["detail"].lower()
    assert "at least one owner" not in refused.text  # nothing about the owner count is disclosed
    assert client.patch(f"{url}/{user_id('tyler')}/role", headers=H(client, "tyler"), json={"role": "owner"}).status_code == 403  # no self-promotion
    with SessionLocal() as db:
        roles = dict(db.execute(select(ProjectMember.user_id, ProjectMember.role).where(ProjectMember.project_id == pid)).all())
    assert roles[user_id("jon")] == "owner" and roles[user_id("tyler")] == "manager"  # nothing changed

    # The owner themself still hits the invariant: 400, and they stay the owner.
    blocked = client.patch(sole_owner, headers=H(client, "jon"), json={"role": "manager"})
    assert blocked.status_code == 400 and blocked.json()["detail"] == "Project must have at least one owner"


# ---------------------------------------------------------------------------
# UC-22
# ---------------------------------------------------------------------------
def test_uc22_deadline_reminder_job_creates_each_reminder_once_and_pushes_it_live_se_nfr12(client, monkeypatch):
    project = new_project(client, owner="jon", members=["staff", "preethi"], name="Reminder job")
    pid = project["id"]
    due_soon = new_task(client, pid, title="Due in six hours", assignee_id=user_id("staff"), due_date=iso(future(0.25)))
    new_task(client, pid, title="Due next week", assignee_id=user_id("preethi"), due_date=iso(future(7)))
    done = new_task(client, pid, title="Already done", assignee_id=user_id("preethi"), due_date=iso(future(0.2)), status="done")
    assert client.post(f"/api/tasks/{due_soon['id']}/soft-deadlines", headers=H(client, "jon"), json={"title": "Checkpoint", "due_at": iso(future(0.1)), "priority": "high"}).status_code == 201

    def reminders(who: str) -> list[dict]:
        """This test's reminders only (other tests leave reminders for the same demo users)."""
        items = client.get("/api/notifications", headers=H(client, who)).json()["items"]
        return [n for n in items if n["kind"] in ("deadline_reminder", "soft_deadline_reminder") and n["project_id"] == pid]

    assert reminders("staff") == []  # opening the list creates nothing: reminders come from the job
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": H(client, "staff")["Authorization"].split()[1]})
        assert ws.receive_json()["type"] == "connected"
        result = client.post("/api/notifications/reminders/run", headers=H(client, "preethi"))  # anyone may run the job in demo mode
        assert result.status_code == 200 and result.json()["scope"] == "all" and result.json()["reminders_created"] >= 2
        pushed = []
        while len([m for m in pushed if m["data"]["project_id"] == pid]) < 2:  # skip reminders other tests left due
            message = ws.receive_json()
            assert message["type"] == "notification"
            pushed.append(message)
        pushed = [m for m in pushed if m["data"]["project_id"] == pid]
    assert {m["data"]["kind"] for m in pushed} == {"deadline_reminder", "soft_deadline_reminder"}
    mine = reminders("staff")
    assert sorted(n["kind"] for n in mine) == ["deadline_reminder", "soft_deadline_reminder"] and all(n["task_id"] == due_soon["id"] for n in mine)
    assert reminders("preethi") == []  # her only due-soon item is finished and the other is a week away
    # Running it again changes nothing (deduplicated), and the plain function agrees with the endpoint.
    with SessionLocal() as db:
        checked, created = run_deadline_reminders(db)
        assert created == [] and checked >= 1
    assert client.post("/api/notifications/reminders/run", headers=H(client, "staff")).json()["reminders_created"] == 0
    assert client.post("/api/notifications/reminders/run").status_code == 401
    # Mark as read still works and the unread badge follows.
    before = client.get("/api/notifications", headers=H(client, "staff")).json()["unread_count"]
    assert client.patch(f"/api/notifications/{mine[0]['id']}/read", headers=H(client, "staff")).json()["is_read"] is True
    assert client.get("/api/notifications", headers=H(client, "staff")).json()["unread_count"] == before - 1

    # Outside demo mode a person can only trigger their own reminders.
    real_settings = collab_module.get_settings()
    monkeypatch.setattr(collab_module, "get_settings", lambda: dataclasses.replace(real_settings, demo_mode=False))
    project2 = new_project(client, owner="jon", members=["staff", "preethi"], name="Reminder job 2")
    new_task(client, project2["id"], title="Mine", assignee_id=user_id("staff"), due_date=iso(future(0.3)))
    new_task(client, project2["id"], title="Theirs", assignee_id=user_id("preethi"), due_date=iso(future(0.3)))
    own = client.post("/api/notifications/reminders/run", headers=H(client, "staff")).json()
    assert own["scope"] == "self" and own["users_checked"] == 1 and own["reminders_created"] == 1 and own["mine"] == 1
    with SessionLocal() as db:
        theirs = db.execute(select(func.count()).select_from(Notification).where(Notification.user_id == user_id("preethi"), Notification.project_id == project2["id"], Notification.kind == "deadline_reminder")).scalar_one()
        assert theirs == 0


# ---------------------------------------------------------------------------
# UC-16
# ---------------------------------------------------------------------------
def test_uc16_a_hidden_widget_can_be_shown_again_and_bad_actions_are_named_se_fr23(client):
    jon = H(client, "jon")
    data = client.get("/api/dashboard/widgets", headers=jon).json()
    widget = next(w for w in data["widgets"] if w["widget_type"] == "project_progress")
    assert client.patch(f"/api/dashboard/widgets/{widget['id']}/show", headers=jon).json()["detail"] == "Invalid action"  # not hidden
    hidden = client.patch(f"/api/dashboard/widgets/{widget['id']}/hide", headers=jon).json()
    assert next(w for w in hidden["widgets"] if w["id"] == widget["id"])["is_hidden"] is True and "project_progress" not in hidden["data"]
    assert client.patch(f"/api/dashboard/widgets/{widget['id']}/hide", headers=jon).json()["detail"] == "Invalid action"
    shown = client.patch(f"/api/dashboard/widgets/{widget['id']}/show", headers=jon).json()
    restored = next(w for w in shown["widgets"] if w["id"] == widget["id"])
    assert restored["is_hidden"] is False and (restored["grid_x"], restored["grid_y"]) == (widget["grid_x"], widget["grid_y"]) and "project_progress" in shown["data"]
    assert client.patch(f"/api/dashboard/widgets/{widget['id']}/show", headers=H(client, "staff")).json()["detail"] == "Invalid action"  # not theirs
    assert client.post("/api/dashboard/widgets", headers=jon, json={"widget_type": "nope"}).json()["detail"] == "Widget unavailable"
    assert client.post("/api/dashboard/widgets", headers=jon, json={"widget_type": "project_progress"}).json()["detail"] == "Invalid action"  # already there
    assert client.delete("/api/dashboard/widgets/00000000-0000-4000-8000-00000000dead", headers=jon).json()["detail"] == "Invalid action"
    # While it was hidden another widget may take its place; showing it again must not overlap anything.
    client.patch(f"/api/dashboard/widgets/{widget['id']}/hide", headers=jon)
    other = next(w for w in client.get("/api/dashboard/widgets", headers=jon).json()["widgets"] if w["widget_type"] == "task_progress")
    assert client.put(f"/api/dashboard/widgets/{other['id']}/position", headers=jon, json={"grid_x": widget["grid_x"], "grid_y": widget["grid_y"]}).status_code == 200
    final = client.patch(f"/api/dashboard/widgets/{widget['id']}/show", headers=jon).json()
    boxes = [(w["grid_x"], w["grid_y"], w["width"], w["height"]) for w in final["widgets"] if not w["is_hidden"]]
    for i, a in enumerate(boxes):
        for b in boxes[i + 1:]:
            assert not (a[0] < b[0] + b[2] and a[0] + a[2] > b[0] and a[1] < b[1] + b[3] and a[1] + a[3] > b[1]), (a, b)
    client.post("/api/dashboard/widgets/restore-default", headers=jon)


# ---------------------------------------------------------------------------
# The four documented accounts: role checks, real files, "nothing to export"
# ---------------------------------------------------------------------------
def test_se_nfr02_seeded_roles_see_what_their_role_allows_and_the_outsider_sees_nothing_uc01_uc02(client):
    owner, manager, member, outsider = (account_headers(client, f"{n}@projectforge.dev") for n in ("owner", "manager", "member", "outsider"))
    launch = project_named(client, owner, POPULATED_PROJECT)
    sandbox = project_named(client, owner, EMPTY_PROJECT)
    pid = launch["id"]
    assert [p["name"] for p in client.get("/api/projects", headers=outsider).json()] == []  # in no project at all
    assert sorted(p["name"] for p in client.get("/api/projects", headers=member).json()) == [POPULATED_PROJECT]
    assert {m["username"]: m["role"] for m in client.get(f"/api/projects/{pid}/members", headers=owner).json()} == {"owner": "owner", "manager": "manager", "member": "member"}

    # UC-01: the money is visible to owner and manager (separately, with the stage total) and refused to the member.
    for headers in (owner, manager):
        costs = client.get(f"/api/projects/{pid}/costs", headers=headers)
        assert costs.status_code == 200
        body = costs.json()
        assert body["bid_amount"] == "25000.00" and body["budget_amount"] == "20000.00"
        assert body["stage_cost_sum"] == "13000.75" and body["sum_label"] == "Total"  # 2500.00 + 9000.50 + 1500.25
        assert body["expense_total"] == "1425.89" and len(body["expenses"]) == 5  # 29.99 + 850.00 + 199.00 + 34.50 + 312.40
        subtotal = client.get(f"/api/projects/{pid}/costs", headers=headers, params={"stage_ids": ",".join(s["id"] for s in body["stage_costs"][:2])}).json()
        assert subtotal["stage_cost_sum"] == "11500.50" and subtotal["sum_label"] == "Subtotal"
    refused = client.get(f"/api/projects/{pid}/costs", headers=member)
    assert refused.status_code == 403 and refused.json() == {"detail": "Access denied"}
    for path, method in ((f"/api/projects/{pid}/costs", "get"), (f"/api/projects/{pid}/tasks", "get"), (f"/api/projects/{pid}/members", "get"), (f"/api/projects/{pid}/reports/performance", "get"), (f"/api/projects/{pid}", "get")):
        assert getattr(client, method)(path, headers=outsider).status_code == 403, path
    assert client.get(f"/api/projects/{sandbox['id']}", headers=member).status_code == 403  # the member is not in the sandbox
    # UC-02 / UC-03: team report for owner and manager, the member's own hours only, hours kept apart.
    team = client.get(f"/api/projects/{pid}/reports/performance", headers=manager).json()
    assert team["scope"] == "team" and {m["username"] for m in team["members"]} == {"owner", "manager", "member"}
    mine = client.get(f"/api/projects/{pid}/reports/performance", headers=member).json()
    assert mine["scope"] == "self" and [m["username"] for m in mine["members"]] == ["member"]
    row = mine["members"][0]
    assert row["actual_hours"] == 7.25 and row["estimated_hours"] > 0 and row["assigned_hours"] > 0  # 3.50 + 2.25 + 1.50 logged on the schema task
    assert mine["totals"]["actual_hours"] == 7.25  # nobody else's hours leak into the member's totals
    tasks = client.get(f"/api/projects/{pid}/tasks", headers=member).json()
    own = next(t for t in tasks if t["title"] == "Design the database schema")
    assert client.post(f"/api/projects/{pid}/tasks/{own['id']}/hours", headers=member, json={"estimated_hours": 99}).status_code == 403
    assert client.post(f"/api/projects/{pid}/tasks/{own['id']}/hours", headers=manager, json={"estimated_hours": 11, "assigned_hours": 13}).status_code == 200
    assert client.post(f"/api/projects/{pid}/tasks/{own['id']}/hours", headers=member, json={"actual_hours": 1, "note": "extra"}).json()["actual_hours"] == 8.25
    # Soft deadlines and tasks follow the matrix.
    assert client.post(f"/api/projects/{pid}/tasks", headers=member, json={"title": "x", "due_date": iso(future(3))}).status_code == 403
    mgr_task = next(t for t in tasks if t["title"] == "Set up the CI pipeline")
    assert client.post(f"/api/tasks/{mgr_task['id']}/soft-deadlines", headers=member, json={"title": "x", "due_at": iso(future(1))}).status_code == 403  # not assigned to the member
    assert client.post(f"/api/tasks/{own['id']}/soft-deadlines", headers=member, json={"title": "Own checkpoint", "due_at": iso(future(1)), "priority": "low"}).status_code == 201


def test_uc14_uc15_exports_are_real_files_scoped_to_the_role_and_say_nothing_to_export_when_empty(client):
    owner, member = account_headers(client, "owner@projectforge.dev"), account_headers(client, "member@projectforge.dev")
    pid = project_named(client, owner, POPULATED_PROJECT)["id"]
    sandbox = project_named(client, owner, EMPTY_PROJECT)["id"]

    ics = client.post(f"/api/projects/{pid}/export/calendar", headers=member, json={"target": "ical"})
    assert ics.status_code == 200 and ics.headers["content-type"].startswith("text/calendar")
    assert "attachment" in ics.headers["content-disposition"] and ics.headers["content-disposition"].endswith('.ics"')
    text = ics.content.decode("utf-8")
    assert text.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") and text.endswith("END:VCALENDAR\r\n")
    assert text.count("BEGIN:VEVENT") == text.count("END:VEVENT") == int(ics.headers["x-export-count"]) >= 8  # project + 7 tasks (+ soft deadlines)
    assert all(len(line.encode("utf-8")) <= 75 for line in text.split("\r\n")) and "Implement the login flow" in text.replace("\r\n ", "")
    assert client.post(f"/api/projects/{sandbox}/export/calendar", headers=member, json={"target": "ical"}).status_code == 403  # not in that project

    full = client.post(f"/api/projects/{pid}/export/spreadsheet", headers=owner, json={"target": "excel"})
    assert full.status_code == 200 and full.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert full.content[:2] == b"PK" and zipfile.is_zipfile(io.BytesIO(full.content))  # a real .xlsx (zip) file
    workbook = load_workbook(io.BytesIO(full.content))
    assert {"Tasks", "Soft deadlines", "Time entries", "Bid & budget", "Stage costs", "Expenses"} == set(workbook.sheetnames)
    assert workbook["Stage costs"].max_row == 4 and workbook["Tasks"].max_row == 8
    limited = client.post(f"/api/projects/{pid}/export/spreadsheet", headers=member, json={"target": "excel", "sections": ["tasks", "expenses", "financials", "time_entries"]})
    assert limited.status_code == 200
    member_book = load_workbook(io.BytesIO(limited.content))
    assert set(member_book.sheetnames) == {"Tasks", "Time entries"}  # no financial sheet for a member
    people = {row[0].value for row in member_book["Time entries"].iter_rows(min_row=2)}
    assert people == {"member"}  # only their own hours

    # Empty project: nothing to export (spreadsheet, and calendar once its own deadline is unticked).
    empty_sheet = client.post(f"/api/projects/{sandbox}/export/spreadsheet", headers=owner, json={"target": "excel"})
    assert empty_sheet.status_code == 400 and empty_sheet.json()["detail"] == "Nothing to export"
    only_project_deadline = client.post(f"/api/projects/{sandbox}/export/calendar", headers=owner, json={"target": "ical"})
    assert only_project_deadline.status_code == 200 and int(only_project_deadline.headers["x-export-count"]) == 1
    nothing = client.post(f"/api/projects/{sandbox}/export/calendar", headers=owner, json={"target": "ical", "include_project_deadline": False})
    assert nothing.status_code == 400 and nothing.json()["detail"] == "Nothing to export"
    # Google / Outlook: consent first; without OAuth credentials a clear 503 (never a made-up success).
    for target in ("google", "outlook"):
        no_consent = client.post(f"/api/projects/{pid}/export/calendar", headers=owner, json={"target": target})
        assert no_consent.status_code == 400 and "no data was shared" in no_consent.json()["detail"]
        unconfigured = client.post(f"/api/projects/{pid}/export/calendar", headers=owner, json={"target": target, "oauth_consent": True})
        assert unconfigured.status_code == 503 and "not set up" in unconfigured.json()["detail"]
    sheets = client.post(f"/api/projects/{pid}/export/spreadsheet", headers=owner, json={"target": "sheets"})
    assert sheets.status_code == 503 and "not set up" in sheets.json()["detail"] and "link" not in sheets.json()


def test_seed_is_repeatable_and_adds_only_what_is_missing():
    from app.seed import seed_test_accounts

    with SessionLocal() as db:
        before = (db.execute(select(func.count()).select_from(UserProfile)).scalar_one(), db.execute(select(func.count()).select_from(ProjectMember)).scalar_one())
        assert seed_test_accounts(db) == {"users": 0, "projects": 0}
        assert (db.execute(select(func.count()).select_from(UserProfile)).scalar_one(), db.execute(select(func.count()).select_from(ProjectMember)).scalar_one()) == before
        # A missing account is added back without touching the others.
        gone = db.execute(select(UserProfile).where(UserProfile.username == "outsider")).scalar_one()
        db.delete(gone)
        db.commit()
        assert seed_test_accounts(db) == {"users": 1, "projects": 0}
        assert db.execute(select(UserProfile.id).where(UserProfile.email == "outsider@projectforge.dev")).first() is not None
    _account_tokens.pop("outsider@projectforge.dev", None)
