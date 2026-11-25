-- =============================================================================
-- 0003_stage_labor.sql
-- @author  Jon Sorey (cost labor breakdown; UI idea ported from Preethi Seereddy's frontend)
-- @description  Labor comparison per cost stage. A stage gets an hourly rate and estimated hours, and each time
--   entry can name the stage it was worked on. Labor dollars are a COMPARISON only: they are never added into
--   stage_cost_sum or any project total (docs/decisions/004-financial-precision-and-stage-costs.md).
-- @traces  SE-FR-01, SE-FR-04, SE-FR-05, SE-NFR-01, SE-NFR-02, UC-01, UC-03, UC-04
--
-- RLS: stage_costs stays readable and writable only by owners and managers (policy stage_costs_managers in
-- 0001). Members get stage NAMES only, through the backend endpoint GET /api/projects/{id}/stages; no policy is
-- added for them here.
-- =============================================================================

alter table public.stage_costs
  add column if not exists hourly_rate     numeric(12, 2) check (hourly_rate is null or hourly_rate >= 0),
  add column if not exists estimated_hours numeric(8, 2)  check (estimated_hours is null or estimated_hours >= 0);

alter table public.time_entries
  add column if not exists stage_cost_id uuid references public.stage_costs(id) on delete set null;

create index if not exists ix_time_entries_stage on public.time_entries (stage_cost_id);

-- A time entry can only point at a stage of its own project (same rule as guard_expense_stage in 0002).
create or replace function public.guard_time_entry_stage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage_cost_id is not null
     and not exists (select 1 from public.stage_costs where id = new.stage_cost_id and project_id = new.project_id) then
    raise exception 'That stage does not belong to this project' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_time_entry_stage on public.time_entries;
create trigger trg_guard_time_entry_stage
  before insert or update of stage_cost_id, project_id on public.time_entries
  for each row execute function public.guard_time_entry_stage();
