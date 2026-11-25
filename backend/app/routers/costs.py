"""
@author: Jon Sorey
@description: The project's money screen. Only owners and managers can see or change the bid, the budget,
    the cost of each project stage and the list of expenses - a member gets "403 Access denied" and no
    numbers at all. The four kinds of money are kept in separate buckets and never added together. Stage
    costs are summed with exact decimal arithmetic rounded half-up to the cent and labelled "Total" when
    every stage is included or "Subtotal" when only some are. Expenses can be searched, filtered by
    category and sorted by date, amount or category using database indexes (O(log N + K)).
    Labor breakdown (UI idea ported from Preethi Seereddy's frontend): each stage may carry an hourly rate and
    estimated hours, and finished time entries can name their stage. Labor dollars (rate x hours, rounded once
    half-up to the cent) are a COMPARISON only and are never added into the stage-cost total (ADR 004).
@traces: SE-FR-01, SE-FR-02, SE-FR-03, SE-FR-04, SE-FR-05, SE-NFR-01, SE-NFR-02, UC-01, UC-03, UC-04
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db, utcnow
from app.core.permissions import ALL_ROLES, MANAGERS, require_project_role
from app.core.security import get_current_user
from app.models.entities import EXPENSE_CATEGORIES, Expense, Project, ProjectFinancials, StageCost, TimeEntry, UserProfile
from app.schemas.dto import (
    CostSummaryOut,
    ExpenseCreate,
    ExpenseOut,
    ExpenseUpdate,
    FinancialsUpdate,
    StageCostCreate,
    StageCostOut,
    StageCostUpdate,
    StageNameOut,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["costs"])
CENT = Decimal("0.01")


def money_sum(values) -> Decimal:
    """SE-NFR-01: exact Decimal sum, rounded half-up to $0.01."""
    total = Decimal("0")
    for value in values:
        total += Decimal(str(value))
    return total.quantize(CENT, rounding=ROUND_HALF_UP)


def labor_cost(rate: Decimal | None, hours: Decimal | None) -> Decimal | None:
    """rate x hours, rounded once half-up to the cent; None when either input is missing (shown as N/A)."""
    if rate is None or hours is None:
        return None
    return (Decimal(str(rate)) * Decimal(str(hours))).quantize(CENT, rounding=ROUND_HALF_UP)


def finished_hours_by_stage(db: Session, project_id: str) -> tuple[dict[str, Decimal], Decimal]:
    """Finished hours per stage, plus the finished hours with no stage. Running timers are excluded."""
    rows = db.execute(
        select(TimeEntry.stage_cost_id, func.coalesce(func.sum(TimeEntry.duration_hours), 0))
        .where(TimeEntry.project_id == project_id, TimeEntry.ended_at.is_not(None))
        .group_by(TimeEntry.stage_cost_id)
    ).all()
    per_stage: dict[str, Decimal] = {}
    unstaged = Decimal("0")
    for stage_id, total in rows:
        value = Decimal(str(total)).quantize(CENT, rounding=ROUND_HALF_UP)
        if stage_id is None:
            unstaged = value
        else:
            per_stage[stage_id] = value
    return per_stage, unstaged


def stage_out(stage: StageCost, actual: Decimal) -> StageCostOut:
    return StageCostOut(
        id=stage.id,
        stage_name=stage.stage_name,
        amount=stage.amount,
        position=stage.position,
        notes=stage.notes,
        hourly_rate=stage.hourly_rate,
        estimated_hours=stage.estimated_hours,
        actual_hours=actual,
        labor_estimated=labor_cost(stage.hourly_rate, stage.estimated_hours),
        # Actual labor needs a rate; with no finished hours it is a real 0.00, not N/A.
        labor_actual=labor_cost(stage.hourly_rate, actual),
    )


def stage_cost_summary(stages: list[StageCost], included_ids: set[str] | None) -> tuple[Decimal, str, list[str]]:
    """Returns (sum, "Total" | "Subtotal", included ids). Only stage costs are ever summed here."""
    if included_ids is None:
        included = stages
    else:
        included = [s for s in stages if s.id in included_ids]
    label = "Total" if len(included) == len(stages) else "Subtotal"
    return money_sum(s.amount for s in included), label, [s.id for s in included]


def _financials(db: Session, project_id: str) -> ProjectFinancials:
    fin = db.get(ProjectFinancials, project_id)
    if fin is None:
        fin = ProjectFinancials(project_id=project_id, bid_amount=Decimal("0.00"), budget_amount=Decimal("0.00"))
        db.add(fin)
        db.flush()
    return fin


def _ensure_project(db: Session, project_id: str) -> None:
    if db.get(Project, project_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")


def _validate_stage(db: Session, project_id: str, stage_cost_id: str | None) -> None:
    if stage_cost_id is None:
        return
    stage = db.get(StageCost, stage_cost_id)
    if stage is None or stage.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That stage does not belong to this project")


SORT_COLUMNS = {"expense_date": Expense.expense_date, "amount": Expense.amount, "category": Expense.category}


@router.get("/costs", response_model=CostSummaryOut)
def get_costs(
    project_id: str,
    search: str | None = Query(None, max_length=100),
    category: str | None = Query(None),
    sort_by: Literal["expense_date", "amount", "category"] = Query("expense_date"),
    sort_dir: Literal["asc", "desc"] = Query("desc"),
    stage_ids: str | None = Query(None, description="Comma-separated stage ids to include in the sum"),
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CostSummaryOut:
    """UC-01: owner / manager only. Members are refused before any financial row is read."""
    require_project_role(db, user.id, project_id, MANAGERS)
    _ensure_project(db, project_id)
    if category is not None and category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown expense category")

    fin = _financials(db, project_id)
    stages = db.execute(
        select(StageCost).where(StageCost.project_id == project_id).order_by(StageCost.position, StageCost.created_at)
    ).scalars().all()
    selected = None
    if stage_ids is not None and stage_ids.strip() != "":
        selected = {s.strip() for s in stage_ids.split(",") if s.strip()}
    stage_sum, label, included = stage_cost_summary(list(stages), selected)
    hours_by_stage, unstaged_hours = finished_hours_by_stage(db, project_id)
    stage_rows = [stage_out(s, hours_by_stage.get(s.id, Decimal("0.00"))) for s in stages]
    est_values = [r.labor_estimated for r in stage_rows if r.labor_estimated is not None]
    act_values = [r.labor_actual for r in stage_rows if r.labor_actual is not None]

    stmt = select(Expense).where(Expense.project_id == project_id)
    if category:
        stmt = stmt.where(Expense.category == category)
    if search:
        term = "%" + search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(or_(Expense.description.ilike(term, escape="\\"), Expense.category.ilike(term, escape="\\")))
    column = SORT_COLUMNS[sort_by]
    ordering = column.asc() if sort_dir == "asc" else column.desc()
    expenses = db.execute(stmt.order_by(ordering, Expense.created_at.desc(), Expense.id)).scalars().all()

    categories = sorted(
        db.execute(select(Expense.category).where(Expense.project_id == project_id).distinct()).scalars()
    )
    db.commit()  # persists a lazily created financials row
    return CostSummaryOut(
        project_id=project_id,
        currency=fin.currency,
        bid_amount=fin.bid_amount,
        budget_amount=fin.budget_amount,
        stage_costs=stage_rows,
        stage_cost_sum=stage_sum,
        sum_label=label,
        included_stage_ids=included,
        expenses=[ExpenseOut.model_validate(e) for e in expenses],
        expense_total=money_sum(e.amount for e in expenses),
        expense_count=len(expenses),
        categories=list(categories),
        unstaged_hours=unstaged_hours,
        labor_estimated_total=money_sum(est_values) if est_values else None,
        labor_actual_total=money_sum(act_values) if act_values else None,
    )


@router.get("/stages", response_model=list[StageNameOut])
def list_stage_names(project_id: str, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)) -> list[StageNameOut]:
    """UC-04: any project member may pick a stage when tracking time. Names only - no amounts or rates."""
    require_project_role(db, user.id, project_id, ALL_ROLES)
    _ensure_project(db, project_id)
    stages = db.execute(
        select(StageCost).where(StageCost.project_id == project_id).order_by(StageCost.position, StageCost.created_at)
    ).scalars().all()
    return [StageNameOut(id=s.id, stage_name=s.stage_name) for s in stages]


@router.put("/financials", response_model=CostSummaryOut)
def update_financials(
    project_id: str, body: FinancialsUpdate, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)
) -> CostSummaryOut:
    require_project_role(db, user.id, project_id, MANAGERS)
    _ensure_project(db, project_id)
    fin = _financials(db, project_id)
    if body.bid_amount is not None:
        fin.bid_amount = body.bid_amount
    if body.budget_amount is not None:
        fin.budget_amount = body.budget_amount
    if body.currency is not None:
        fin.currency = body.currency
    fin.updated_by = user.id
    fin.updated_at = utcnow()
    db.commit()
    return get_costs(project_id, None, None, "expense_date", "desc", None, user, db)


@router.post("/stage-costs", response_model=StageCostOut, status_code=status.HTTP_201_CREATED)
def create_stage_cost(
    project_id: str, body: StageCostCreate, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageCostOut:
    require_project_role(db, user.id, project_id, MANAGERS)
    _ensure_project(db, project_id)
    position = body.position
    if position is None:
        position = int(
            db.execute(select(func.coalesce(func.max(StageCost.position), -1)).where(StageCost.project_id == project_id)).scalar_one()
        ) + 1
    stage = StageCost(
        project_id=project_id,
        stage_name=body.stage_name,
        amount=body.amount,
        hourly_rate=body.hourly_rate,
        estimated_hours=body.estimated_hours,
        notes=body.notes,
        position=position,
    )
    db.add(stage)
    db.commit()
    return stage_out(stage, finished_hours_by_stage(db, project_id)[0].get(stage.id, Decimal("0.00")))


def _stage(db: Session, project_id: str, stage_id: str) -> StageCost:
    stage = db.get(StageCost, stage_id)
    if stage is None or stage.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stage cost not found")
    return stage


@router.put("/stage-costs/{stage_id}", response_model=StageCostOut)
def update_stage_cost(
    project_id: str,
    stage_id: str,
    body: StageCostUpdate,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StageCostOut:
    require_project_role(db, user.id, project_id, MANAGERS)
    stage = _stage(db, project_id, stage_id)
    if body.stage_name is not None:
        stage.stage_name = body.stage_name
    if body.amount is not None:
        stage.amount = body.amount
    if body.notes is not None:
        stage.notes = body.notes
    if body.position is not None:
        stage.position = body.position
    fields = body.model_fields_set
    if "hourly_rate" in fields:  # an explicit null clears the rate
        stage.hourly_rate = body.hourly_rate
    if "estimated_hours" in fields:
        stage.estimated_hours = body.estimated_hours
    db.commit()
    return stage_out(stage, finished_hours_by_stage(db, project_id)[0].get(stage.id, Decimal("0.00")))


@router.delete("/stage-costs/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage_cost(
    project_id: str, stage_id: str, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    require_project_role(db, user.id, project_id, MANAGERS)
    stage = _stage(db, project_id, stage_id)
    db.query(Expense).filter(Expense.stage_cost_id == stage.id).update({Expense.stage_cost_id: None})
    db.query(TimeEntry).filter(TimeEntry.stage_cost_id == stage.id).update({TimeEntry.stage_cost_id: None})
    db.delete(stage)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/expenses", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
def create_expense(
    project_id: str, body: ExpenseCreate, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)
) -> ExpenseOut:
    require_project_role(db, user.id, project_id, MANAGERS)
    _ensure_project(db, project_id)
    _validate_stage(db, project_id, body.stage_cost_id)
    expense = Expense(
        project_id=project_id,
        stage_cost_id=body.stage_cost_id,
        category=body.category,
        description=body.description,
        amount=body.amount,
        expense_date=body.expense_date,
        created_by=user.id,
    )
    db.add(expense)
    db.commit()
    return ExpenseOut.model_validate(expense)


def _expense(db: Session, project_id: str, expense_id: str) -> Expense:
    expense = db.get(Expense, expense_id)
    if expense is None or expense.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
    return expense


@router.put("/expenses/{expense_id}", response_model=ExpenseOut)
def update_expense(
    project_id: str,
    expense_id: str,
    body: ExpenseUpdate,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExpenseOut:
    require_project_role(db, user.id, project_id, MANAGERS)
    expense = _expense(db, project_id, expense_id)
    fields = body.model_fields_set
    if "stage_cost_id" in fields:
        _validate_stage(db, project_id, body.stage_cost_id)
        expense.stage_cost_id = body.stage_cost_id
    if body.category is not None:
        expense.category = body.category
    if body.description is not None:
        expense.description = body.description
    if body.amount is not None:
        expense.amount = body.amount
    if body.expense_date is not None:
        expense.expense_date = body.expense_date
    db.commit()
    return ExpenseOut.model_validate(expense)


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    project_id: str, expense_id: str, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    require_project_role(db, user.id, project_id, MANAGERS)
    db.delete(_expense(db, project_id, expense_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
