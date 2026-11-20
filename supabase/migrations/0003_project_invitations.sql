-- =============================================================================
-- @author: Aashwat Singh (invitations: UC-19, SE-FR-30, SE-NFR-11)
-- @description: Adds pending project invitations. An owner or manager invites an existing user; the
--   invitation changes nothing about the project until the invitee accepts it (the API then creates the
--   membership). It also allows the two new notification kinds ("invitation", "invitation_response").
--   Row-Level Security: an invitee sees (and may decline) only their own invitations; owners and managers
--   see, create and cancel their project's invitations; only an owner may invite someone as owner; nobody
--   else sees anything. The script is idempotent: running it twice changes nothing.
-- @traces: SE-FR-30, SE-NFR-02, SE-NFR-11, UC-19
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Notification kinds: replace the inline CHECK (whatever its generated name) with a named one.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.notifications'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.notifications drop constraint %I', c.conname);
  end loop;
  alter table public.notifications add constraint ck_notifications_kind
    check (kind in ('mention', 'assignment', 'role_change', 'member_added', 'member_removed',
                    'deadline_reminder', 'soft_deadline_reminder', 'task_reassigned', 'project_update',
                    'invitation', 'invitation_response', 'system'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. project_invitations (Aashwat Singh: UC-19)
-- ---------------------------------------------------------------------------
create table if not exists public.project_invitations (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  invitee_id    uuid not null references public.user_profiles(id) on delete cascade,
  invited_by    uuid references public.user_profiles(id) on delete set null,
  role          varchar(10) not null default 'member'
                check (role in ('owner', 'manager', 'member')),
  status        varchar(10) not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);
-- At most one open invitation per person per project (a second simultaneous invite fails here).
create unique index if not exists uq_project_invitations_one_pending
  on public.project_invitations (project_id, invitee_id) where status = 'pending';
create index if not exists ix_project_invitations_invitee_status on public.project_invitations (invitee_id, status);
create index if not exists ix_project_invitations_project_status on public.project_invitations (project_id, status);

-- Only an owner may invite someone as owner; an invitation is created pending and answered once.
create or replace function public.guard_project_invitations() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.app_current_user_id();
  caller_role text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'An invitation starts as pending' using errcode = '23514';
    end if;
    if caller is not null then
      select role into caller_role from public.project_members where project_id = new.project_id and user_id = caller;
      if caller_role is null or caller_role not in ('owner', 'manager') then
        raise exception 'Access denied' using errcode = '42501';
      end if;
      if new.role = 'owner' and caller_role <> 'owner' then
        raise exception 'Only an owner can grant or remove the owner role' using errcode = '42501';
      end if;
      if new.invited_by is distinct from caller then
        raise exception 'An invitation must name its real sender' using errcode = '42501';
      end if;
    end if;
    if exists (select 1 from public.project_members where project_id = new.project_id and user_id = new.invitee_id) then
      raise exception 'That person is already a member of this project' using errcode = '23505';
    end if;
  else
    if new.project_id <> old.project_id or new.invitee_id <> old.invitee_id or new.role <> old.role then
      raise exception 'An invitation cannot be changed, only answered' using errcode = '42501';
    end if;
    if old.status <> 'pending' then
      raise exception 'This invitation has already been answered' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_project_invitations on public.project_invitations;
create trigger trg_guard_project_invitations
  before insert or update on public.project_invitations
  for each row execute function public.guard_project_invitations();

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.project_invitations enable row level security;

drop policy if exists project_invitations_select on public.project_invitations;
create policy project_invitations_select on public.project_invitations
  for select using (
    invitee_id = public.app_current_user_id()
    or public.app_project_role(project_id) in ('owner', 'manager')
  );
drop policy if exists project_invitations_insert on public.project_invitations;
create policy project_invitations_insert on public.project_invitations
  for insert with check (public.app_project_role(project_id) in ('owner', 'manager'));
-- Owners / managers may withdraw (cancel); the invitee may decline. Accepting creates a membership, which only
-- the server does, so a client can never join a project by editing its own invitation.
drop policy if exists project_invitations_update on public.project_invitations;
create policy project_invitations_update on public.project_invitations
  for update using (
    invitee_id = public.app_current_user_id()
    or public.app_project_role(project_id) in ('owner', 'manager')
  ) with check (
    (invitee_id = public.app_current_user_id() and status = 'declined')
    or (public.app_project_role(project_id) in ('owner', 'manager') and status = 'cancelled')
  );
