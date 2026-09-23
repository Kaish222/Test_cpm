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
2. Run the full **`supabase-schema.sql`** once on a new project. It includes table creation, public dashboard reads and the unique-name migration. Existing projects use the upgrade above instead.
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

Ranges fill fully covered half-hour slots with exclusive end times: 17:00–19:00 fills 17:00, 17:30, 18:00 and 18:30. The final 22:00 row ends at 22:30. Sets of UUIDs prevent duplicate labels. FNV-1a hashing of each UUID assigns a stable pastel color from a 12-color palette. Coaches appear first in bold with a C badge, then students; names sort alphabetically inside each group. Three labels fit per cell; +N more opens a dialog with everyone. Escape or Close dismisses it. The grid scrolls with sticky time/day headers. Submitted text renders as text, never HTML.

## Files

- `index.html`, `style.css`: form, calendar and existing visual styles; name lookup status is beside the name field.
- `script.js`: selection, validation, name lookup state and save flow.
- `supabase-api.js`: client configuration validation, name lookup RPC, save RPC and dashboard query.
- `coach-dashboard.js`: role visibility, calendar/table rendering, loading and refresh after save.
- `supabase-config.js`: public project URL/key, preserved during this update.
- `supabase-schema.sql`: complete new-project setup.
- `supabase-coach-dashboard.sql`: existing-project public-read migration.
- `supabase-unique-names.sql`: duplicate consolidation, name uniqueness and lookup/replacement RPCs.

## Test

1. After the migration, enter Kaif, select Student and Monday 17:00–19:00, and save.
2. Reload and enter `  KAIF  `. Verify Monday 17:00 through 18:30 are selected and Student is restored. There must still be only one person for that normalized name.
3. Replace Monday with Wednesday 14:00–15:00 and submit. Verify the same UUID now has only Wednesday's range. Repeat submission and confirm no extra person/ranges appear.
4. Change the role to Coach and save. Verify the same person is updated and the coach calendar refreshes. For another name, the grid must start empty.
5. Type names quickly while requests are slow. Only the last name's results should load. Simulate offline mode: a failed lookup must not allow overwriting a different person's schedule.
6. Verify existing duplicate names have one canonical person containing all distinct original ranges after migration. Test overlapping student/coach schedules, +N more, the detailed table and Student hiding as before.
7. Test rollback in SQL Editor using an existing test name and an invalid range (`18:00` to `17:00`) through `submit_availability`. It must error, leaving that person's prior role and ranges intact.

Console errors such as “function not found” mean the migration is missing or the API schema cache needs refreshing. The browser Network panel shows `get_person_availability` for lookup and `submit_availability` for saves. Dashboard reads require the earlier SELECT policies. Keep RLS enabled. Mocked frontend tests do not replace verification of SQL and permissions in the configured database.
