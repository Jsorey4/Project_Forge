"""
@author: eLeet Coderz (Team 3) - demo scenario: Jon Sorey; per-feature data from each feature owner
@description: Fills an empty database with a realistic demo so the app is useful the moment it starts:
    seven teammates (Jon = Owner, Tyler = Manager with 2FA on, "staff" = Member, plus the rest of the team),
    three projects, feature lists, tasks with tags and hours, soft deadlines, comments with @mentions,
    bids / budgets / stage costs / expenses, time entries and notifications. Dates are relative to "now"
    so deadlines are always upcoming. seed_demo_data() does nothing if any user already exists.
    seed_test_accounts() adds four documented sign-ins for manual testing (owner@, manager@, member@ and
    outsider@projectforge.dev, all with 2FA and the demo password) with a populated project ("Forge
    Launch Plan") and an empty one ("Empty Sandbox"); it can be run any number of times and only adds
    what is missing.
@traces: UC-01..UC-22 (demo data), SE-FR-01..SE-FR-30
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import utcnow
from app.core.security import generate_mfa_secret, hash_password
from app.models.entities import (
    Comment,
    Expense,
    Notification,
    Project,
    ProjectFinancials,
    ProjectMember,
    SoftDeadline,
    StageCost,
    Task,
    TaskList,
    TimeEntry,
    UserProfile,
)

logger = logging.getLogger("projectforge.seed")

DEMO_PEOPLE = [
    # username, display name, mfa
    ("jon", "Jon Sorey", False),
    ("tyler", "Tyler Gaines", True),
    ("staff", "Staff Member", False),
    ("preethi", "Preethi Seereddy", False),
    ("saaqib", "Saaqib Shaik", False),
    ("myoram", "Myoram Langwang", False),
    ("aashwat", "Aashwat Singh", False),
]


def _day(now: datetime, days: int, hour: int = 17) -> datetime:
    return (now + timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)


def seed_demo_data(db: Session) -> bool:
    if db.execute(select(func.count()).select_from(UserProfile)).scalar_one() > 0:
        return False
    settings = get_settings()
    now = utcnow()
    password_hash = hash_password(settings.demo_password)

    users: dict[str, UserProfile] = {}
    for username, display, mfa in DEMO_PEOPLE:
        user = UserProfile(
            username=username,
            email=f"{username}@example.com",
            display_name=display,
            password_hash=password_hash,
            mfa_enabled=mfa,
            mfa_secret=generate_mfa_secret() if mfa else None,
            theme="dark",
            color_blind_mode="none",
            default_project_type="work",
            created_at=now - timedelta(days=60),
        )
        db.add(user)
        users[username] = user
    db.flush()
    u = {k: v.id for k, v in users.items()}

    # ------------------------------------------------------------------ projects
    platform = Project(
        name="ProjectForge Platform",
        description="Build and launch the ProjectForge web app: auth, boards, costs, time tracking and reports.",
        status="active",
        project_type="work",
        deadline=_day(now, 45),
        created_by=u["jon"],
        created_at=now - timedelta(days=40),
    )
    semester = Project(
        name="CS 3354 Semester Deliverables",
        description="SRS, design document, test plan and the final presentation for CS 3354.001.",
        status="active",
        project_type="school",
        deadline=_day(now, 21, 23),
        created_by=u["tyler"],
        created_at=now - timedelta(days=50),
    )
    portfolio = Project(
        name="Personal Portfolio Site",
        description="A small personal site to show off semester projects.",
        status="planning",
        project_type="personal",
        deadline=_day(now, 60),
        created_by=u["staff"],
        created_at=now - timedelta(days=10),
    )
    db.add_all([platform, semester, portfolio])
    db.flush()

    def member(project: Project, username: str, role: str, color: str, order: int) -> None:
        db.add(ProjectMember(project_id=project.id, user_id=u[username], role=role, card_color=color, card_order=order, joined_at=project.created_at))

    member(platform, "jon", "owner", "#6366F1", 0)
    member(platform, "tyler", "manager", "#6366F1", 0)
    member(platform, "staff", "member", "#6366F1", 0)
    for name in ("preethi", "saaqib", "myoram", "aashwat"):
        member(platform, name, "member", "#6366F1", 0)
    member(semester, "tyler", "owner", "#0EA5E9", 1)
    member(semester, "jon", "manager", "#0EA5E9", 1)
    member(semester, "staff", "member", "#0EA5E9", 1)
    member(semester, "preethi", "member", "#0EA5E9", 1)
    member(semester, "aashwat", "manager", "#0EA5E9", 1)
    member(portfolio, "staff", "owner", "#10B981", 2)
    member(portfolio, "aashwat", "member", "#10B981", 2)

    def lists(project: Project, names: list[str]) -> dict[str, TaskList]:
        out = {}
        for i, n in enumerate(names):
            lst = TaskList(project_id=project.id, name=n, position=i, created_at=project.created_at)
            db.add(lst)
            out[n] = lst
        db.flush()
        return out

    pl = lists(platform, ["Planning", "Backend", "Frontend", "Testing"])
    sl = lists(semester, ["Documents", "Presentation"])
    ol = lists(portfolio, ["Design", "Build"])

    positions: dict[tuple[str, str], int] = {}

    def task(project, lst, title, status, assignee, due_days, priority="medium", tags=(), est=None, assigned=None, desc=""):
        key = (project.id, status)
        pos = positions.get(key, 0)
        positions[key] = pos + 1
        t = Task(
            project_id=project.id,
            list_id=lst.id,
            title=title,
            description=desc,
            status=status,
            priority=priority,
            assignee_id=u[assignee] if assignee else None,
            due_date=_day(now, due_days),  # UC-18: every task has a due date
            position=pos,
            tags=list(tags),
            estimated_hours=Decimal(str(est)) if est is not None else None,
            assigned_hours=Decimal(str(assigned)) if assigned is not None else None,
            completed_at=now - timedelta(days=2) if status == "done" else None,
            created_by=project.created_by,
            created_at=project.created_at + timedelta(days=1),
        )
        db.add(t)
        return t

    t_req = task(platform, pl["Planning"], "Write the requirements traceability matrix", "done", "preethi", -5, "high", ["docs"], 6, 6,
                 "Map every **SE-FR** and **SE-NFR** to a use case and a test.")
    t_erd = task(platform, pl["Planning"], "Finalize the database schema (13 tables)", "done", "jon", -3, "high", ["database"], 8, 8)
    t_auth = task(platform, pl["Backend"], "Login lockout and rate limiting", "done", "tyler", -1, "urgent", ["security", "auth"], 10, 10)
    t_costs = task(platform, pl["Backend"], "Cost summary API with Decimal math", "in_progress", "jon", 6, "high", ["finance"], 12, 12)
    t_board = task(platform, pl["Frontend"], "Board drag-and-drop", "in_progress", "staff", 4, "high", ["frontend", "ux"], 8, 10,
                   "Cards move between columns and keep their order.\n\n- Snap back on failure\n- Keyboard accessible")
    t_widgets = task(platform, pl["Frontend"], "Dashboard widgets with overlap detection", "review", "myoram", 3, "medium", ["frontend"], 9, 9)
    t_export = task(platform, pl["Backend"], "Calendar and spreadsheet exports", "todo", "saaqib", 9, "medium", ["exports"], 7, 8)
    t_comments = task(platform, pl["Backend"], "Markdown comments with @mentions", "review", "aashwat", 2, "medium", ["collaboration"], 6, 6)
    t_a11y = task(platform, pl["Frontend"], "Color-blind friendly palettes", "todo", "staff", 12, "medium", ["accessibility"], 5, 5)
    t_tests = task(platform, pl["Testing"], "Pytest suite for UC-01 to UC-22", "todo", "staff", 15, "high", ["testing"], 10, 12)
    task(platform, pl["Testing"], "Load test the dashboard (3 s budget)", "todo", None, 20, "low", ["performance"], 4, None)
    t_soft = task(platform, pl["Backend"], "Soft deadline validation", "in_progress", "preethi", 7, "medium", ["deadlines"], 6, 6)

    s_srs = task(semester, sl["Documents"], "Software Requirements Specification", "done", "preethi", -10, "high", ["deliverable"], 12, 12)
    s_design = task(semester, sl["Documents"], "Design document with UML diagrams", "in_progress", "staff", 5, "high", ["deliverable", "uml"], 15, 14)
    s_test = task(semester, sl["Documents"], "Test plan", "todo", "aashwat", 10, "medium", ["deliverable"], 8, 8)
    s_slides = task(semester, sl["Presentation"], "Final presentation slides", "todo", "jon", 18, "medium", ["presentation"], 6, 6)

    o_wire = task(portfolio, ol["Design"], "Sketch wireframes", "in_progress", "staff", 8, "low", ["design"], 3, 3)
    task(portfolio, ol["Build"], "Pick a static site generator", "todo", "aashwat", 14, "low", ["research"], 2, 2)
    db.flush()

    # ------------------------------------------------------------ soft deadlines
    def soft(t: Task, title: str, days_before_due: float, done: bool = False, priority: str = "medium") -> None:
        due = t.due_date - timedelta(days=days_before_due)
        db.add(
            SoftDeadline(
                task_id=t.id,
                project_id=t.project_id,
                title=title,
                due_at=due,
                priority=priority,
                is_completed=done,
                completed_at=now - timedelta(days=1) if done else None,
                created_by=t.assignee_id,
                created_at=t.created_at,
            )
        )

    soft(t_board, "Prototype drag handles", 3, done=True, priority="high")
    soft(t_board, "Review with Myoram", 1, priority="medium")
    soft(t_costs, "Subtotal / Total labels", 4, priority="high")
    soft(t_soft, "Edge-case tests", 2, priority="low")
    soft(s_design, "Class diagram draft", 3, priority="high")
    soft(s_design, "Sequence diagrams", 1.5)
    soft(t_tests, "Auth and lockout tests", 8, priority="high")
    soft(o_wire, "Mobile layout", 3)

    # ----------------------------------------------------------------- comments
    def comment(t: Task, author: str, body: str, minutes_ago: int) -> None:
        db.add(Comment(task_id=t.id, project_id=t.project_id, author_id=u[author], body=body, created_at=now - timedelta(minutes=minutes_ago)))

    comment(t_board, "tyler", "Looks great so far. @staff can you make sure **failed moves snap back**?", 300)
    comment(t_board, "staff", "Yes - the card returns to its original column and a banner offers *Retry*.", 240)
    comment(t_board, "myoram", "Reusing the same `overlaps()` idea from the widgets would be neat.", 120)
    comment(t_costs, "jon", "Remember: bids, budgets and expenses are **never** added together.\n\n- Stage costs only\n- Round half-up", 600)
    comment(t_comments, "aashwat", "Sanitizer strips `<script>` and `javascript:` links. @tyler please review.", 90)
    comment(s_design, "preethi", "I can help with the sequence diagrams, @staff.", 200)

    # ---------------------------------------------------------------- financials
    db.add(ProjectFinancials(project_id=platform.id, bid_amount=Decimal("48500.00"), budget_amount=Decimal("42000.00"), currency="USD", updated_by=u["jon"]))
    db.add(ProjectFinancials(project_id=semester.id, bid_amount=Decimal("0.00"), budget_amount=Decimal("350.00"), currency="USD", updated_by=u["tyler"]))
    stages = [
        ("Requirements", "4250.00"),
        ("Design", "6800.50"),
        ("Implementation", "18400.25"),
        ("Testing", "5120.10"),
        ("Deployment", "2300.00"),
    ]
    stage_rows = []
    for i, (name, amount) in enumerate(stages):
        s = StageCost(project_id=platform.id, stage_name=name, amount=Decimal(amount), position=i, notes="")
        db.add(s)
        stage_rows.append(s)
    db.add(StageCost(project_id=semester.id, stage_name="Printing & materials", amount=Decimal("120.00"), position=0, notes="Poster and handouts"))
    db.flush()
    today = now.date()
    expenses = [
        ("software", "Supabase Pro plan (1 month)", "25.00", 30, 4),
        ("software", "Figma team seat", "45.00", 28, 1),
        ("labor", "Contract QA tester - week 1", "1200.00", 21, 3),
        ("labor", "Contract QA tester - week 2", "1200.00", 14, 3),
        ("equipment", "USB-C test devices", "389.99", 18, 3),
        ("services", "Domain + TLS certificate", "34.50", 25, 4),
        ("travel", "Client demo travel", "212.35", 9, None),
        ("materials", "Printed user guides", "87.60", 5, 4),
        ("other", "Team lunch after sprint review", "96.40", 2, None),
    ]
    for category, desc, amount, days_ago, stage_index in expenses:
        db.add(
            Expense(
                project_id=platform.id,
                stage_cost_id=stage_rows[stage_index].id if stage_index is not None else None,
                category=category,
                description=desc,
                amount=Decimal(amount),
                expense_date=today - timedelta(days=days_ago),
                created_by=u["jon"],
            )
        )
    db.add(Expense(project_id=semester.id, category="materials", description="Poster printing", amount=Decimal("64.25"), expense_date=today - timedelta(days=3), created_by=u["tyler"]))

    # -------------------------------------------------------------- time entries
    def log(t: Task, username: str, days_ago: int, hours: str, note: str = "") -> None:
        start = datetime.combine(today - timedelta(days=days_ago), datetime.min.time()) + timedelta(hours=14)
        h = Decimal(hours)
        db.add(
            TimeEntry(
                project_id=t.project_id,
                task_id=t.id,
                user_id=u[username],
                source="timer" if days_ago % 2 == 0 else "manual",
                started_at=start,
                ended_at=start + timedelta(seconds=int(h * 3600)),
                paused_seconds=0,
                duration_hours=h,
                note=note,
            )
        )

    log(t_req, "preethi", 20, "3.50")
    log(t_req, "preethi", 18, "3.25")
    log(t_erd, "jon", 16, "4.00")
    log(t_erd, "jon", 15, "5.50")
    log(t_auth, "tyler", 12, "6.00")
    log(t_auth, "tyler", 10, "5.25")
    log(t_costs, "jon", 6, "4.75")
    log(t_costs, "jon", 3, "2.50")
    log(t_board, "staff", 9, "3.00", "Initial column layout")
    log(t_board, "staff", 6, "4.25", "Drag handles")
    log(t_board, "staff", 2, "2.00", "Snap-back on failure")
    log(t_widgets, "myoram", 7, "5.00")
    log(t_widgets, "myoram", 4, "4.50")
    log(t_comments, "aashwat", 5, "3.75")
    log(t_comments, "aashwat", 1, "2.25")
    log(t_soft, "preethi", 4, "2.50")
    log(t_export, "saaqib", 3, "1.50")
    log(s_srs, "preethi", 25, "6.00")
    log(s_srs, "preethi", 22, "7.00")
    log(s_design, "staff", 5, "3.50")
    log(s_design, "staff", 1, "2.75")
    log(o_wire, "staff", 2, "1.25")

    # ------------------------------------------------------------- notifications
    def notify(username: str, kind: str, message: str, link: str, minutes_ago: int, project=None, t=None, read=False) -> None:
        db.add(
            Notification(
                user_id=u[username],
                kind=kind,
                message=message,
                link=link,
                project_id=project.id if project else None,
                task_id=t.id if t else None,
                is_read=read,
                created_at=now - timedelta(minutes=minutes_ago),
            )
        )

    notify("staff", "mention", "Tyler Gaines mentioned you on “Board drag-and-drop”", f"/tasks/{t_board.id}", 300, platform, t_board)
    notify("staff", "assignment", "Jon Sorey assigned you “Pytest suite for UC-01 to UC-22”", f"/tasks/{t_tests.id}", 1440, platform, t_tests)
    notify("staff", "mention", "Preethi Seereddy mentioned you on “Design document with UML diagrams”", f"/tasks/{s_design.id}", 200, semester, s_design)
    notify("tyler", "mention", "Aashwat Singh mentioned you on “Markdown comments with @mentions”", f"/tasks/{t_comments.id}", 90, platform, t_comments)
    notify("jon", "system", "Welcome to ProjectForge! Use the demo role switcher in the sidebar to try each role.", "/dashboard", 2000, read=True)
    notify("jon", "role_change", "Your role in “CS 3354 Semester Deliverables” changed from member to manager", f"/projects/{semester.id}", 4000, semester)

    db.commit()
    logger.info("Seeded demo data: %d users, 3 projects. Demo password: %s", len(users), "(DEMO_PASSWORD)")
    return True


# ----------------------------------------------------------------------------------------------------
# Four documented accounts for manual testing of every use case (see backend/seed.py and the README).
# ----------------------------------------------------------------------------------------------------
TEST_ACCOUNTS = [
    # username, email, display name, what they are for
    ("owner", "owner@projectforge.dev", "Project Owner", "Owner of both projects"),
    ("manager", "manager@projectforge.dev", "Project Manager", "Manager in both projects"),
    ("member", "member@projectforge.dev", "Regular Member", "Member of Forge Launch Plan with assigned tasks"),
    ("outsider", "outsider@projectforge.dev", "Outside User", "Signed up but in NO project (cross-project denial)"),
]
POPULATED_PROJECT = "Forge Launch Plan"
EMPTY_PROJECT = "Empty Sandbox"


def seed_test_accounts(db: Session) -> dict[str, int]:
    """Adds the four test accounts and their two projects when they are missing. Safe to run repeatedly."""
    settings = get_settings()
    now = utcnow()
    added = {"users": 0, "projects": 0}
    password_hash = hash_password(settings.demo_password)

    users: dict[str, UserProfile] = {}
    for username, email, display, _purpose in TEST_ACCOUNTS:
        existing = db.execute(select(UserProfile).where(func.lower(UserProfile.email) == email)).scalar_one_or_none()
        if existing is None:
            existing = UserProfile(
                username=username,
                email=email,
                display_name=display,
                password_hash=password_hash,
                mfa_enabled=True,  # UC-09: the second step applies; in demo mode the code is DEMO_MFA_CODE
                mfa_secret=generate_mfa_secret(),
                theme="dark",
                color_blind_mode="none",
                default_project_type="work",
                created_at=now - timedelta(days=30),
            )
            db.add(existing)
            added["users"] += 1
        users[username] = existing
    db.flush()
    u = {k: v.id for k, v in users.items()}

    def project_exists(name: str) -> bool:
        return db.execute(select(Project.id).where(Project.name == name, Project.created_by == u["owner"])).first() is not None

    def add_member(project: Project, username: str, role: str, color: str, order: int) -> None:
        db.add(ProjectMember(project_id=project.id, user_id=u[username], role=role, card_color=color, card_order=order, joined_at=project.created_at))

    def add_lists(project: Project, names: list[str]) -> dict[str, TaskList]:
        out = {}
        for i, name in enumerate(names):
            lst = TaskList(project_id=project.id, name=name, position=i, created_at=project.created_at)
            db.add(lst)
            out[name] = lst
        db.flush()
        return out

    # ------------------------------------------------------------------ populated project
    if not project_exists(POPULATED_PROJECT):
        launch = Project(
            name=POPULATED_PROJECT,
            description="Everything needed to ship ProjectForge v1: schema, login, CI and the launch checklist.",
            status="active",
            project_type="work",
            deadline=_day(now, 30),
            created_by=u["owner"],
            created_at=now - timedelta(days=20),
        )
        db.add(launch)
        db.flush()
        add_member(launch, "owner", "owner", "#6366F1", 0)
        add_member(launch, "manager", "manager", "#6366F1", 0)
        add_member(launch, "member", "member", "#6366F1", 0)
        lists = add_lists(launch, ["Planning", "Build", "Launch"])
        positions: dict[str, int] = {}

        def task(title, list_name, status, assignee, due, priority="medium", tags=(), est=None, assigned=None, desc="") -> Task:
            pos = positions.get(status, 0)
            positions[status] = pos + 1
            t = Task(
                project_id=launch.id,
                list_id=lists[list_name].id,
                title=title,
                description=desc,
                status=status,
                priority=priority,
                assignee_id=u[assignee] if assignee else None,
                due_date=due,
                position=pos,
                tags=list(tags),
                estimated_hours=Decimal(str(est)) if est is not None else None,
                assigned_hours=Decimal(str(assigned)) if assigned is not None else None,
                completed_at=now - timedelta(days=4) if status == "done" else None,
                created_by=u["manager"],
                created_at=now - timedelta(days=15),
            )
            db.add(t)
            db.flush()
            return t

        t_charter = task("Write the project charter", "Planning", "done", "manager", now - timedelta(days=3), "high", ["docs"], 4, 4)
        t_schema = task("Design the database schema", "Build", "in_progress", "member", now + timedelta(days=4), "high", ["database"], 10, 12,
                        "Tables for users, projects, tasks and **costs**. Keep money as exact decimals.")
        t_login = task("Implement the login flow", "Build", "todo", "member", now + timedelta(hours=6), "urgent", ["auth"], 6, 6)
        t_ci = task("Set up the CI pipeline", "Build", "review", "manager", _day(now, 9), "medium", ["devops"], 5, 5)
        t_flaky = task("Fix the flaky export test", "Build", "in_progress", "member", now - timedelta(days=1), "high", ["tests"], 3, 3)
        t_review = task("Run the cost review meeting", "Planning", "todo", "owner", _day(now, 2), "medium", ["finance"], 2, 2)
        t_check = task("Prepare the launch checklist", "Launch", "todo", None, _day(now, 20), "low", ["launch"])
        t_check.tags = ["launch", "docs"]

        def soft(t: Task, title: str, due: datetime, priority: str, done: bool = False) -> None:
            db.add(SoftDeadline(task_id=t.id, project_id=launch.id, title=title, due_at=due, priority=priority, is_completed=done,
                                completed_at=now - timedelta(days=1) if done else None, created_by=t.assignee_id or u["manager"], created_at=now - timedelta(days=5)))

        soft(t_schema, "Draft the schema", t_schema.due_date - timedelta(days=3), "high", done=True)
        soft(t_schema, "Review with the manager", t_schema.due_date - timedelta(days=1), "medium")
        soft(t_login, "Login form working", now + timedelta(hours=3), "high")
        soft(t_ci, "Pipeline runs on pull requests", t_ci.due_date - timedelta(days=4), "low")
        soft(t_review, "Collect the expense report", t_review.due_date - timedelta(hours=12), "medium")

        def comment(t: Task, who: str, body: str, minutes_ago: int) -> None:
            db.add(Comment(task_id=t.id, project_id=launch.id, author_id=u[who], body=body, created_at=now - timedelta(minutes=minutes_ago)))

        comment(t_schema, "manager", "Nice start. @member please keep **money as exact decimals**, no floats.", 180)
        comment(t_schema, "member", "Will do. I added `NUMERIC(12,2)` for every amount.", 120)
        comment(t_login, "owner", "This one is due today - shout if you are blocked. @member @manager", 45)

        db.add(ProjectFinancials(project_id=launch.id, bid_amount=Decimal("25000.00"), budget_amount=Decimal("20000.00"), currency="USD", updated_by=u["owner"]))
        stage_rows = []
        for i, (name, amount) in enumerate([("Planning", "2500.00"), ("Build", "9000.50"), ("Launch", "1500.25")]):
            row = StageCost(project_id=launch.id, stage_name=name, amount=Decimal(amount), position=i, notes="")
            db.add(row)
            stage_rows.append(row)
        db.flush()
        today = now.date()
        for category, desc, amount, days_ago, stage in [
            ("software", "Hosting plan (1 month)", "29.99", 14, 1),
            ("labor", "Contract designer - week 1", "850.00", 12, 0),
            ("equipment", "Test phone", "199.00", 9, 1),
            ("services", "Domain and certificate", "34.50", 7, 2),
            ("travel", "Customer demo trip", "312.40", 4, None),
        ]:
            db.add(Expense(project_id=launch.id, stage_cost_id=stage_rows[stage].id if stage is not None else None, category=category,
                           description=desc, amount=Decimal(amount), expense_date=today - timedelta(days=days_ago), created_by=u["owner"]))

        def log(t: Task, who: str, days_ago: int, hours: str, note: str = "") -> None:
            start = datetime.combine(today - timedelta(days=days_ago), datetime.min.time()) + timedelta(hours=14)
            h = Decimal(hours)
            db.add(TimeEntry(project_id=launch.id, task_id=t.id, user_id=u[who], source="timer" if days_ago % 2 == 0 else "manual",
                             started_at=start, ended_at=start + timedelta(seconds=int(h * 3600)), paused_seconds=0, duration_hours=h, note=note))

        log(t_charter, "manager", 8, "3.50")
        log(t_charter, "manager", 7, "1.25")
        log(t_schema, "member", 3, "3.50", "ER diagram")
        log(t_schema, "member", 2, "2.25", "Migrations")
        log(t_schema, "member", 1, "1.50")
        log(t_ci, "manager", 2, "4.00")
        log(t_review, "owner", 1, "1.00")

        for who, kind, message, link, minutes_ago, t in [
            ("member", "assignment", "Project Manager assigned you “Design the database schema”", f"/tasks/{t_schema.id}", 1400, t_schema),
            ("member", "mention", "Project Manager mentioned you on “Design the database schema”", f"/tasks/{t_schema.id}", 180, t_schema),
            ("member", "mention", "Project Owner mentioned you on “Implement the login flow”", f"/tasks/{t_login.id}", 45, t_login),
            ("manager", "mention", "Project Owner mentioned you on “Implement the login flow”", f"/tasks/{t_login.id}", 45, t_login),
        ]:
            db.add(Notification(user_id=u[who], kind=kind, message=message, link=link, project_id=launch.id, task_id=t.id, created_at=now - timedelta(minutes=minutes_ago)))
        added["projects"] += 1

    # ------------------------------------------------------------------ empty project
    if not project_exists(EMPTY_PROJECT):
        sandbox = Project(
            name=EMPTY_PROJECT,
            description="A project with no tasks, costs or hours: use it to see \"Nothing to export\" and empty reports.",
            status="planning",
            project_type="personal",
            deadline=_day(now, 60),
            created_by=u["owner"],
            created_at=now - timedelta(days=2),
        )
        db.add(sandbox)
        db.flush()
        add_member(sandbox, "owner", "owner", "#10B981", 1)
        add_member(sandbox, "manager", "manager", "#10B981", 1)
        add_lists(sandbox, ["Planning", "Development", "Testing"])
        added["projects"] += 1

    db.commit()
    if added["users"] or added["projects"]:
        logger.info("Seeded test accounts: %d new user(s), %d new project(s).", added["users"], added["projects"])
    return added
