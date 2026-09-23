-- Existing databases: run this entire migration in Supabase SQL Editor.
-- Old records remain unchanged. NOT VALID exempts existing rows, but enforces
-- the new rules on every new insert/update (including replacement saves).
begin;
alter table public.availability drop constraint if exists availability_grid_bounds;
alter table public.availability drop constraint if exists availability_half_hour_alignment;
alter table public.availability drop constraint if exists availability_twenty_minute_alignment;
alter table public.availability add constraint availability_grid_bounds
  check (start_time >= time '11:40' and end_time <= time '19:00') not valid;
alter table public.availability add constraint availability_twenty_minute_alignment check (
  extract(second from start_time) = 0 and extract(second from end_time) = 0
  and extract(minute from start_time) in (0, 20, 40)
  and extract(minute from end_time) in (0, 20, 40)
) not valid;
notify pgrst, 'reload schema';
commit;
