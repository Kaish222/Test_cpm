-- Existing database: run this ENTIRE file after the unique-name and 20-minute migrations.
-- Keeps all existing rows, giving them preference = 'available'.
begin;
alter table public.availability
  add column if not exists preference text not null default 'available';
alter table public.availability alter column preference set default 'available';
update public.availability set preference = 'available' where preference is null;
alter table public.availability alter column preference set not null;
alter table public.availability drop constraint if exists availability_preference_check;
alter table public.availability add constraint availability_preference_check
  check (preference in ('preferred', 'available', 'possible'));
grant select (preference) on public.availability to anon;

-- The complete updated save and lookup functions follow below.

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
