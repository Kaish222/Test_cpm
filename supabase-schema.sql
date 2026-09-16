-- Initial setup for a new Supabase project. Run the whole file once in SQL Editor.
-- Intentionally fails if these tables already exist; do not drop existing data.
begin;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  role text not null check (role in ('student', 'coach')),
  created_at timestamptz not null default now()
);

create table public.availability (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  day text not null check (day in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint availability_positive_range check (end_time > start_time),
  constraint availability_grid_bounds check (start_time >= time '08:00' and end_time <= time '22:30'),
  constraint availability_half_hour_alignment check (
    extract(second from start_time) = 0 and extract(second from end_time) = 0
    and extract(minute from start_time) in (0, 30)
    and extract(minute from end_time) in (0, 30)
  ),
  constraint availability_unique_range unique (person_id, day, start_time, end_time)
);
-- The unique index starts with person_id and also supports foreign-key lookups.

alter table public.people enable row level security;
alter table public.availability enable row level security;

revoke all on table public.people, public.availability from public, anon, authenticated;
grant usage on schema public to anon;
grant insert (id, name, role) on public.people to anon;
grant insert (person_id, day, start_time, end_time) on public.availability to anon;

create policy people_anonymous_insert on public.people
  for insert to anon with check (true);
create policy availability_anonymous_insert on public.availability
  for insert to anon with check (true);
-- No SELECT, UPDATE or DELETE grants/policies for anonymous callers.

-- Both inserts run in one transaction. Any error rolls back both.
-- SECURITY INVOKER obeys the caller's INSERT-only grants and RLS policies.
create function public.submit_availability(p_name text, p_role text, p_ranges jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_person_id uuid := gen_random_uuid();
begin
  if p_ranges is null or jsonb_typeof(p_ranges) <> 'array' then
    raise exception 'Availability must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ranges) not between 1 and 203 then
    raise exception 'Provide between 1 and 203 availability ranges' using errcode = '22023';
  end if;

  -- Generate the ID here so INSERT needs neither RETURNING nor table read access.
  insert into public.people (id, name, role)
    values (new_person_id, btrim(p_name), p_role);

  insert into public.availability (person_id, day, start_time, end_time)
    select new_person_id, ranges.day, ranges.start_time, ranges.end_time
    from jsonb_to_recordset(p_ranges) as ranges(day text, start_time time, end_time time);

  return new_person_id;
end;
$$;

revoke all on function public.submit_availability(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_availability(text, text, jsonb) to anon;

commit;
