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
  preference text not null default 'available' constraint availability_preference_check check (preference in ('preferred', 'available', 'possible')),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint availability_positive_range check (end_time > start_time),
  constraint availability_grid_bounds check (start_time >= time '11:40' and end_time <= time '19:00'),
  constraint availability_twenty_minute_alignment check (
    extract(second from start_time) = 0 and extract(second from end_time) = 0
    and extract(minute from start_time) in (0, 20, 40)
    and extract(minute from end_time) in (0, 20, 40)
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
-- Temporary public reads for the coach development dashboard.
grant select (id, name, role) on public.people to anon;
grant select (id, person_id, day, start_time, end_time, preference) on public.availability to anon;
create policy people_anonymous_select on public.people
  for select to anon using (true);
create policy availability_anonymous_select on public.availability
  for select to anon using (true);
-- No UPDATE or DELETE grants/policies for anonymous callers.


lock table public.people, public.availability in access exclusive mode;

create or replace function public.normalize_person_name(p_name text)
returns text language sql immutable strict set search_path = ''
as $$ select lower(regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g')); $$;

-- Each statement defines its own mapping; no temporary-table lifetime dependency.
with person_merge_map as (
  select id, first_value(id) over (
    partition by public.normalize_person_name(name) order by created_at, id
  ) as keep_id from public.people
)
insert into public.availability (person_id, day, start_time, end_time)
select distinct m.keep_id, a.day, a.start_time, a.end_time
from public.availability a join person_merge_map m on m.id = a.person_id
where m.id <> m.keep_id
on conflict (person_id, day, start_time, end_time) do nothing;
with person_merge_map as (
  select id, first_value(id) over (
    partition by public.normalize_person_name(name) order by created_at, id
  ) as keep_id from public.people
)
delete from public.people p using person_merge_map m
where p.id = m.id and m.id <> m.keep_id;

create unique index if not exists people_unique_normalized_name
on public.people (public.normalize_person_name(name));

-- Only these narrow RPCs may write; do not expose general UPDATE/DELETE access.
revoke insert on public.people, public.availability from anon;
revoke insert (id, name, role) on public.people from anon;
revoke insert (person_id, day, start_time, end_time) on public.availability from anon;

create or replace function public.submit_availability(p_name text, p_role text, p_ranges jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  saved_person_id uuid;
  clean_name text := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if clean_name is null or char_length(clean_name) not between 1 and 120 then
    raise exception 'Please enter a name between 1 and 120 characters' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('student', 'coach') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  if p_ranges is null or jsonb_typeof(p_ranges) <> 'array' then
    raise exception 'Availability must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ranges) not between 1 and 203 then
    raise exception 'Provide between 1 and 203 ranges' using errcode = '22023';
  end if;

  -- The unique index and upsert serialize concurrent saves for the same name.
  insert into public.people (name, role) values (clean_name, p_role)
  on conflict (public.normalize_person_name(name)) do update set role = excluded.role
  returning id into saved_person_id;

  delete from public.availability where person_id = saved_person_id;
  insert into public.availability (person_id, day, start_time, end_time, preference)
  select saved_person_id, r.day, r.start_time, r.end_time, coalesce(r.preference, 'available')
  from jsonb_to_recordset(p_ranges) as r(day text, start_time time, end_time time, preference text);
  -- Any invalid range rolls back the replacement, preserving the previous schedule.
  return saved_person_id;
end;
$$;

create or replace function public.get_person_availability(p_name text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role,
    'ranges', coalesce((select jsonb_agg(jsonb_build_object(
      'day', a.day, 'start_time', a.start_time, 'end_time', a.end_time, 'preference', a.preference))
      from public.availability a where a.person_id = p.id), '[]'::jsonb))
  from public.people p
  where public.normalize_person_name(p.name) = public.normalize_person_name(p_name);
$$;

revoke all on function public.normalize_person_name(text) from public, anon, authenticated;
revoke all on function public.submit_availability(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_person_availability(text) from public, anon, authenticated;
grant execute on function public.submit_availability(text, text, jsonb) to anon;
grant execute on function public.get_person_availability(text) to anon;

-- New clients use this endpoint so an unmigrated database fails visibly instead
-- of silently ignoring preference fields in the old JSON payload.
create or replace function public.submit_availability_with_preferences(p_name text, p_role text, p_ranges jsonb)
returns uuid language sql security invoker set search_path = ''
as $$ select public.submit_availability(p_name, p_role, p_ranges); $$;
revoke all on function public.submit_availability_with_preferences(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_availability_with_preferences(text, text, jsonb) to anon;
notify pgrst, 'reload schema';
commit;
