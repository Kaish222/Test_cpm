-- Run once in Supabase SQL Editor as the database owner, after the initial schema.
-- Consolidates duplicate names, preserving every distinct availability range.
begin;
lock table public.people, public.availability in access exclusive mode;

create or replace function public.normalize_person_name(p_name text)
returns text language sql immutable strict set search_path = ''
as $$ select lower(regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g')); $$;

create temporary table person_merge_map on commit drop as
select id, first_value(id) over (
  partition by public.normalize_person_name(name) order by created_at, id
) as keep_id from public.people;

insert into public.availability (person_id, day, start_time, end_time)
select distinct m.keep_id, a.day, a.start_time, a.end_time
from public.availability a join person_merge_map m on m.id = a.person_id
where m.id <> m.keep_id
on conflict (person_id, day, start_time, end_time) do nothing;
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
  insert into public.availability (person_id, day, start_time, end_time)
  select saved_person_id, r.day, r.start_time, r.end_time
  from jsonb_to_recordset(p_ranges) as r(day text, start_time time, end_time time);
  -- Any invalid range rolls back the replacement, preserving the previous schedule.
  return saved_person_id;
end;
$$;

create or replace function public.get_person_availability(p_name text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role,
    'ranges', coalesce((select jsonb_agg(jsonb_build_object(
      'day', a.day, 'start_time', a.start_time, 'end_time', a.end_time))
      from public.availability a where a.person_id = p.id), '[]'::jsonb))
  from public.people p
  where public.normalize_person_name(p.name) = public.normalize_person_name(p_name);
$$;

revoke all on function public.normalize_person_name(text) from public, anon, authenticated;
revoke all on function public.submit_availability(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_person_availability(text) from public, anon, authenticated;
grant execute on function public.submit_availability(text, text, jsonb) to anon;
grant execute on function public.get_person_availability(text) to anon;
commit;
