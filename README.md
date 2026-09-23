# Availability Planner

Static HTML, CSS and vanilla JavaScript with Supabase. Open `index.html` or deploy the files together to GitHub Pages. Internet access is required for the Supabase CDN/API; no build tools or server are needed.

## Upgrade your existing database: unique names

1. Export/back up the `people` and `availability` tables before consolidation.
2. In Supabase **SQL Editor → New query**, run **`supabase-unique-names.sql`** as the database owner. Do not rerun the initial table-creation schema on an existing database.
3. The migration groups names ignoring case and surrounding whitespace. Names are unique across roles: Student Kaif and Coach KAIF refer to the same person. Internal spaces and accents remain significant.
4. Existing duplicates are consolidated into the earliest-created person's UUID, name and role (UUID breaks timestamp ties). All distinct availability ranges from duplicates are copied to that person before duplicate people are removed. Exact duplicate ranges collapse; overlapping ranges remain stored, but the grid/calendar displays their union. Saving later replaces them with the newly merged selection.
5. Publish the updated files, reload, and enter a name. After a brief pause or leaving the field, existing role and availability load into the selection grid. A new name starts with an empty grid. Changing the name clears the previous person's draft.
6. Submit saves the entire displayed schedule for that name, replacing old ranges. The person UUID and original display-name spelling stay stable; the selected role is updated. This also keeps calendar colors stable. A successful Coach save refreshes the dashboard automatically.

The migration changes stored duplicate records and should be reviewed before running. It executes inside a transaction and locks the two tables during consolidation. It does not run automatically from the frontend. Live SQL and permissions need verification in your Supabase project.

## First-time setup

1. Create a Supabase project and open **SQL Editor → New query**.
2. Run the full **`supabase-schema.sql`** once on a new project. It includes table creation, public dashboard reads, unique names and availability preferences. Existing projects apply migrations in order: unique names, 20-minute slots, then `supabase-preferences.sql`. Do not rerun older function migrations after preferences; they would restore older function definitions.
3. Copy the Project URL from **Connect** / Data API settings and the publishable key from **Settings → API Keys** (legacy anon keys also work).
4. In `supabase-config.js`, replace the placeholders:

   ```js
   const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
   const SUPABASE_ANON_KEY = "sb_publishable_YOUR_PUBLIC_KEY";
   ```

5. Never put a service_role key, `sb_secret_` key or database password in frontend files. Public publishable/anon keys are expected in the browser; they are not user authentication.
6. Keep the Data API enabled with `public` exposed. Submit a test name and confirm its row in **Table Editor → people**, then check `availability` filtered by that person's ID.

For databases still missing the original Coach read policies, also run `supabase-coach-dashboard.sql`. No credentials or SQL are automatically applied by the site.

## Save consistency and prototype access

A unique expression index on `normalize_person_name(name)` enforces uniqueness in the database, including concurrent requests. `submit_availability` uses an upsert to create/find and lock the person, then deletes and replaces their availability in the same transaction. Invalid replacement rows roll back everything and preserve the previous schedule. Concurrent saves serialize; the last successful replacement wins. Identical retries do not create another person or accumulate ranges.

`get_person_availability` returns the matching person's profile and ranges using the same database normalization. The form disables role/selection/submission during lookup, cancels obsolete lookups and ignores late responses. Failed lookup keeps editing locked; leaving the name field retries. Unsaved edits are discarded when changing names. Blank names, missing roles and no selected slots remain invalid; this version does not support saving an empty schedule.

The two RPCs use **SECURITY DEFINER** with an empty `search_path` and qualified table names. This permits the narrow name-based replacement without giving anonymous callers general UPDATE or DELETE privileges. Direct anonymous INSERT column/table grants are revoked so callers cannot append ranges outside the save transaction. Existing SELECT permissions remain for the development dashboard. The original INSERT policies may still exist, but grants deny direct writes. Only the intended RPCs are granted execution to `anon`; RLS remains enabled. No service-role key is used by the browser.

**This is intentionally unauthenticated prototype behavior.** Anyone who knows a name can view and replace that person's availability and role. Anyone can select Coach or query the publicly readable dashboard columns. There is no proof of ownership, password, identity verification or application rate limiting. Do not use this as a private or secure account system.

## Weekly calendar

The Coach dashboard displays a read-only calendar and a collapsible Detailed view. Refresh fetches joined `availability` / `people` records in batches, then builds all views locally, without per-person or per-slot requests. Selecting Student or changing names hides and clears the dashboard; pending responses cannot repopulate it.

Ranges fill fully covered 20-minute slots with exclusive end times: 17:00–19:00 fills 17:00, 17:20, 17:40, 18:00, 18:20 and 18:40. Both grids run from 11:40 to 19:00: 22 slots per day, ending with 18:40–19:00. Sets of UUIDs prevent duplicate labels. FNV-1a hashing of each UUID assigns a stable pastel color from a 12-color palette. Coaches appear first in bold with a C badge, then students; names sort alphabetically inside each group. Three labels fit per cell; +N more opens a dialog with everyone. Escape or Close dismisses it. The grid scrolls with sticky time/day headers. Submitted text renders as text, never HTML.

## Files

- `index.html`, `style.css`: form, calendar and existing visual styles; name lookup status is beside the name field.
- `script.js`: four-state painting, preference-aware merging, validation, name lookup and save flow.
- `preferences.js`: shared labels, symbols, fallback and legacy-overlap display handling.
- `supabase-api.js`: client configuration validation, name lookup RPC, save RPC and dashboard query.
- `coach-dashboard.js`: role visibility, calendar/table rendering, loading and refresh after save.
- `supabase-config.js`: public project URL/key, preserved during this update.
- `supabase-schema.sql`: complete new-project setup.
- `supabase-coach-dashboard.sql`: existing-project public-read migration.
- `supabase-unique-names.sql`: duplicate consolidation, name uniqueness and lookup/replacement RPCs.
- `supabase-preferences.sql`: existing-project preference column, constraint, read grant and updated save/lookup functions.

## Test

1. After the migration, enter Kaif, select Student and Monday 17:00–19:00, and save.
2. Reload and enter `  KAIF  `. Verify Monday 17:00 through 18:40 are selected and Student is restored. There must still be only one person for that normalized name.
3. Replace Monday with Wednesday 14:00–15:00 and submit. Verify the same UUID now has only Wednesday's range. Repeat submission and confirm no extra person/ranges appear.
4. Change the role to Coach and save. Verify the same person is updated and the coach calendar refreshes. For another name, the grid must start empty.
5. Type names quickly while requests are slow. Only the last name's results should load. Simulate offline mode: a failed lookup must not allow overwriting a different person's schedule.
6. Verify existing duplicate names have one canonical person containing all distinct original ranges after migration. Test overlapping student/coach schedules, +N more, the detailed table and Student hiding as before.
7. Test rollback in SQL Editor using an existing test name and an invalid range (`18:00` to `17:00`) through `submit_availability`. It must error, leaving that person's prior role and ranges intact.

Console errors such as “function not found” mean the migration is missing or the API schema cache needs refreshing. The browser Network panel shows `get_person_availability` for lookup and `submit_availability` for saves. Dashboard reads require the earlier SELECT policies. Keep RLS enabled. Mocked frontend tests do not replace verification of SQL and permissions in the configured database.

## Upgrade to 20-minute slots

Run the entire supabase-twenty-minute-slots.sql file in Supabase SQL Editor for an existing database, then publish the updated frontend. New projects use the updated supabase-schema.sql. This migration preserves old rows using NOT VALID constraints while enforcing 11:40–19:00 and 20-minute boundaries for every new write. Old off-grid ranges remain visible in Detailed view; only fully covered cells appear in the grids. The name lookup warns before replacing an old off-grid schedule. Review the selection before saving. No existing database records are automatically clipped or rounded.

Test the first slot (11:40–12:00), the last (18:40–19:00), and two adjacent slots (merged into one 40-minute range). A range ending at 12:20 must not fill the 12:20 cell. The selected-duration summary should report hours and minutes accurately.

## Availability preference levels

The current schedule remains **11:40–19:00 in 20-minute slots**. Select a paint mode above the grid, then click or drag. Space/Enter paints the focused slot. The mode is fixed for each drag gesture, and revisiting a cell never toggles it. Clear all resets every cell.

| Mode | Meaning | Display |
| --- | --- | --- |
| Preferred | Ça m'arrangerait | Soft green, ★ |
| Available | Dispo | Soft blue, ● |
| Possible | Je peux, mais ça m'arrange moins | Soft yellow, ◇ |
| Eraser | Unavailable | Neutral, empty |

All three colored modes count as valid availability, including a schedule containing only Possible slots. Unavailable cells are not saved. The selection is a Map from slot key to preference. `buildAvailabilityData()` merges adjacent cells only if their preferences match; gaps and preference changes start new ranges. Example: preferred 12:00–12:40, available 12:40–13:00, possible 13:00–13:20 produce three rows.

Supabase stores `preference text NOT NULL DEFAULT 'available'`, with a CHECK allowing only `preferred`, `available`, `possible`. The migration backfills legacy records without deleting them. `submit_availability` still replaces all ranges in a single transaction and batches the insert, now including preference. New frontend saves call `submit_availability_with_preferences`, a thin wrapper which fails explicitly if the migration has not been run. This prevents an old RPC from silently ignoring the new field. Older clients using the original RPC without preferences default to Available.

The name lookup returns preferences and restores all colors when reopening a saved person. Missing or unexpected preference values in read data fall back to Available. The dashboard query retrieves preference in the same paginated join; there are no additional per-person/per-slot queries. The new column receives anonymous SELECT permission; no new general write permissions are granted.

Person UUID colors and coach bold/C badges remain unchanged. Each calendar pill additionally shows a small colored preference symbol, with full text in its tooltip and accessible name. The +N more dialog spells out role and preference for everyone. Detailed view has a Preference column. The person legend describes identity/role; the separate symbol legend describes preference. In overlapping legacy rows for one person, the strongest stated preference is displayed (Preferred, then Available, then Possible), independent of input order; this is only display conflict resolution, not matching or scheduling.

### Existing-project migration and testing

1. Apply the earlier unique-name and 20-minute migrations if not already done.
2. Run the **entire `supabase-preferences.sql`** in Supabase SQL Editor. The exact SQL is reproduced below. Adding only the column is insufficient: the save/lookup functions and SELECT grant also need updating.
3. Publish the updated files, including **`preferences.js`**, together and hard-refresh. Configuration values are unchanged.
4. Load an old person: their slots should be blue/Available. Paint adjacent Preferred slots, then Available, then Possible. Erase one cell and save. Reload the name and verify colors and gaps persist.
5. In Table Editor, verify each range includes the correct preference and consecutive different preferences remain separate rows. A Possible-only submission must succeed; an entirely empty selection must fail.
6. Select Coach and Refresh. Verify person colors stay stable, coach badges remain, preference markers vary per slot, full lists include every person's preference, and Detailed view shows readable labels. Student mode must still hide the dashboard.

Frontend logic can be checked with mocked responses, including legacy rows with missing preference. Actual migration execution, database constraints and persistence must be tested in your Supabase project. No authentication, scheduling, matching, or preference weights are implemented.

```sql
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

```
