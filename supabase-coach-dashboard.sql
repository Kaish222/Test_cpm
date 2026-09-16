-- Existing projects: run this migration instead of rerunning the initial schema.
-- WARNING: these columns become publicly readable without authentication.
-- Existing INSERT policies and all stored data are preserved.
begin;
grant select (id, name, role) on public.people to anon;
grant select (id, person_id, day, start_time, end_time) on public.availability to anon;
drop policy if exists people_anonymous_select on public.people;
create policy people_anonymous_select on public.people
  for select to anon using (true);
drop policy if exists availability_anonymous_select on public.availability;
create policy availability_anonymous_select on public.availability
  for select to anon using (true);
commit;
