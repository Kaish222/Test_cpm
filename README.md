# Availability Planner

A static HTML/CSS/vanilla JavaScript form. Select weekly half-hour slots by click, drag or keyboard. Adjacent slots merge per day. The 22:00 row ends at 22:30.

## Configure Supabase

1. Create a project at https://supabase.com/dashboard and wait for provisioning.
2. Open **SQL Editor → New query** in that project.
3. Paste the entire contents of `supabase-schema.sql` and click **Run**. Run it once on a new project. It creates both tables, constraints, RLS policies and the `submit_availability` database function. If these tables already exist, inspect their schema instead of deleting data or rerunning blindly.
4. Copy the **Project URL** from the project's **Connect** dialog (also available in settings under Data API).
5. Open **Settings → API Keys** and copy the **publishable** key (`sb_publishable_...`). A legacy **anon** key also works. Do not copy `sb_secret_...`, `service_role`, or your database password.
6. In **`supabase-config.js`**, replace these two placeholder strings, keeping the quotes:

   ```js
   const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
   const SUPABASE_ANON_KEY = "sb_publishable_YOUR_PUBLIC_KEY";
   ```

7. Never put a **service_role or secret key** in frontend code, this repository or GitHub Pages. Runtime validation rejects such keys, but putting a secret in a public file already exposes it; rotate any accidentally exposed secret.
8. Open `index.html` in a browser, or publish the files and open your GitHub Pages site. Internet access is required for the Supabase CDN/API. No build, npm, server or local environment variables are needed. Hard-refresh after changing configuration.
9. Enter a recognizable test name, choose Student or Coach, and select Monday 17:00, 17:30, 18:00 and Wednesday 14:00. Submit once and wait for **Availability saved successfully.**
10. In Supabase **Table Editor**, find the test name in `people` and copy its `id`. Filter `availability` by that `person_id`: expect Monday `17:00:00–18:30:00` and Wednesday `14:00:00–14:30:00`. Choosing Coach on the website also lists these submitted ranges after the SELECT policies are installed.

The Data API must be enabled with the `public` schema exposed (the usual new-project default). Keep the frontend files together in the GitHub Pages published directory. All local script paths are relative, including on repository subpaths. The Supabase CDN client uses the supported v2 channel and is the only external library.

## Files and submission flow

- `index.html`: existing form and ordered deferred scripts: Supabase CDN, config, API wrapper, then grid.
- `style.css`: existing UI, plus disabled-control feedback.
- `script.js`: grid, merging, validation and save-state UI. Controls are temporarily locked so the displayed selection matches the submitted snapshot. The selection stays after saving.
- `supabase-config.js`: two public configuration values.
- `supabase-api.js`: lazy client initialization, row conversion, one RPC call, 20-second timeout and error propagation.
- `supabase-schema.sql`: initial schema, RLS and atomic insert function.
- `coach-dashboard.js`: role-based visibility, loading/cancellation, weekday sorting and safe table rendering.
- `supabase-coach-dashboard.sql`: SELECT grants/policies migration for an existing database.

`buildAvailabilityData()` still produces `{ name, role, availability: { monday: [{ start, end }] } }`. The API wrapper flattens ranges into `{ day, start_time, end_time }` rows. The SQL function generates a UUID, inserts the person with it, then inserts all ranges in one batch using that `person_id`. It returns only the newly created UUID, without selecting table rows.

## Atomicity and retries

Two separate browser requests cannot share a database transaction. If person creation succeeded and availability failed, browser cleanup would be unreliable: anonymous deletion is forbidden and the connection could disappear.

This version therefore includes one small PostgreSQL RPC function now. It is a database function, not an Edge Function or separate backend server. Both inserts execute in one transaction; a bad availability row rolls back the person and the entire batch. **SECURITY INVOKER** respects the caller's grants and RLS.

The submit handler prevents duplicate in-flight saves. There are no automatic retries. A timeout or lost response can happen **after** commit, so an error may mean the result is unknown. Check Table Editor before retrying. Submitting again after success, using another tab or reloading and submitting creates a new person; cross-request deduplication is not implemented.

## Temporary anonymous-access security

A public publishable/anon key is expected in browser JavaScript. Database grants, RLS and constraints provide protection; the key does not identify a trusted person. Never use a privileged key to fix a permissions error.

Both tables have RLS, the existing anonymous INSERT policies, and temporary anonymous SELECT policies for the dashboard's columns. No UPDATE or DELETE privileges are added. The submission RPC still returns only its newly created UUID. This setup grants no table access to `authenticated`; authentication is outside this version.

**Coach is only a frontend role selector, not an access-control boundary.** Anyone using the public site can choose Coach and view all submitted names, roles and availability. Anyone with the public key can also query the permitted columns directly, even without choosing Coach. Hiding the section for students does not protect database records. Do not treat this development dashboard as private or authenticated.

Anyone can copy the public key and submit arbitrary valid names/roles or spam inserts. There is no identity verification, ownership enforcement, CAPTCHA or application rate limiting. The requested direct INSERT access also allows a caller to bypass the RPC, insert a person without availability, or attach availability to a known person's UUID. Atomicity protects this application's RPC flow, not arbitrary direct API writes. Monitor usage and treat these permissions as temporary prototype settings.

Constraints reject invalid weekdays/roles, empty or overlong names, duplicate exact ranges and invalid times. Slots must align to half hours within 08:00–22:30. Deleting a person through privileged dashboard access cascades to their availability.

## Checks and troubleshooting

- Empty name, missing role or no selection: inline validation and no request.
- Rapid double-click: only one in-flight save. Inputs and selection survive both success and failure.
- Browser Developer Tools → Network: submission uses one POST to `/rest/v1/rpc/submit_availability`, returning a UUID. Choosing Coach or Refresh additionally issues GET requests for joined availability records.
- Errors: the browser console has debugging details. Check configuration, CDN connectivity, SQL setup, Data API exposure, INSERT/RPC grants, and the dashboard SELECT policies. Keep RLS enabled.
- Test rollback in **SQL Editor** using a distinctive name and a backwards range:

  ```sql
  select public.submit_availability(
    'ROLLBACK_TEST', 'student',
    '[{"day":"monday","start_time":"18:00","end_time":"17:00"}]'::jsonb
  );
  ```

  Expect an error. In a **separate query**, run `select * from public.people where name = 'ROLLBACK_TEST';` and expect zero rows. Choose a fresh test name if it already exists.
- Check anonymous reads from SQL Editor: `begin; set local role anon; select id, name, role from public.people; rollback;` should now work. `SELECT *` remains disallowed because column grants deliberately exclude `created_at`. UPDATE and DELETE remain forbidden. Run `rollback;` separately if an error leaves a transaction open.

Frontend checks can use a mocked Supabase client. Real SQL execution, RLS enforcement, successful persistence and rollback must be verified in your configured project; placeholder credentials cannot establish a live connection.

References: [browser client](https://supabase.com/docs/reference/javascript/installing), [database functions and privileges](https://supabase.com/docs/guides/database/functions), [public and secret API keys](https://supabase.com/docs/guides/api/api-keys).

## Enable the temporary coach dashboard

For an **existing** configured database, open Supabase **SQL Editor → New query**, paste all of `supabase-coach-dashboard.sql`, and run it. This migration adds only the required read permissions and policies; it preserves INSERT behavior and data. Do not rerun the initial table-creation script. For a **new** project, the updated `supabase-schema.sql` already includes these additions.

The additional SQL is:

```sql
grant select (id, name, role) on public.people to anon;
grant select (id, person_id, day, start_time, end_time) on public.availability to anon;
create policy people_anonymous_select on public.people
  for select to anon using (true);
create policy availability_anonymous_select on public.availability
  for select to anon using (true);
```

`fetchAllAvailability()` queries `availability` with `people(name, role)` nested in the SELECT. Supabase uses the existing `availability.person_id → people.id` foreign key to join each range to its person. No separate per-person requests are made. The function fetches batches of up to 500 rows ordered by UUID, requesting IDs after the last fetched row until an empty batch. This avoids truncation at the usual API limit, including when a project uses a lower row limit. A missing/unreadable related person triggers an error rather than silently hiding availability. People without any availability do not produce table rows.

The main dashboard is a read-only weekly calendar. The original table remains in the collapsible **Detailed view** below it. `renderAvailabilityTable()` sorts that table by Monday–Sunday, start time, then name. UUID breaks otherwise identical ties. Stored ranges are displayed unchanged with times formatted as HH:MM. Names are inserted with `textContent`, never interpreted as HTML.

`loadCoachDashboard()` runs on choosing Coach and clicking Refresh. It disables Refresh during loading, uses a 30-second timeout, and shows friendly errors. Switching to Student or the blank role hides the section, aborts loading and clears its rows/status. Stale responses cannot repopulate it. Submitting new availability retains the existing save behavior; click Refresh afterward to see the new record. Multiple pages are not a transactional snapshot, so refresh after concurrent submissions or dashboard deletions.

### Test the dashboard

1. Apply the migration, keep the existing public-key configuration, and publish the changed files together. Open `index.html` or GitHub Pages and hard-refresh.
2. With no role or Student selected, confirm there is no dashboard and no dashboard read request.
3. Select Coach. Confirm the dashboard appears and loads names, roles, weekdays, start and end times. Check the visible temporary-access note.
4. Submit test records on several days, including two Monday records with the same start time but different names. Click Refresh. Verify Monday–Sunday order, ascending start times, then names. Compare ranges to Supabase Table Editor.
5. On a fresh empty test project, Coach should show “No availability has been submitted yet.” Do not delete production records just to test this.
6. Simulate an offline connection in browser developer tools and click Refresh. Verify the error message and that Refresh becomes available again; reconnect and retry.
7. Switch to Student while a request is loading, then back to Coach. The section should hide immediately, with no stale results/status, and a new Coach visit should reload.
8. On a narrow screen, horizontally scroll the dashboard table. Confirm the original grid selection, validation and submission still work.

Mocked tests can verify sorting, pagination and UI request handling without a database. Live persistence and permissions still require verification against your configured Supabase project. No authentication, editing, deletion or scheduling has been added.

## Visual weekly calendar

`buildCalendarData()` converts each stored range into fully covered half-hour slots. For example, 17:00–19:00 fills 17:00, 17:30, 18:00 and 18:30, but not 19:00. The existing 22:00 row represents 22:00–22:30. A Set of person IDs per cell prevents duplicate labels if the same person's ranges overlap. Different people with the same name remain distinct by UUID.

`getColorForPerson()` hashes the person UUID using FNV-1a and maps the result to a fixed 12-color pastel palette. The same ID keeps its color across slots, refreshes and reloads; palette colors may repeat. Colors are never stored in Supabase. A repeated submission creates a different person UUID and can therefore receive a different color.

Within each cell and the legend, coaches come first, then students, with alphabetical names inside each group. Coach labels are bold and carry a small **C** badge; the legend also spells out each role. The cells contain no editing or selection controls.

Each slot shows at most three labels and a **+N more** button. Click it (or use Tab and Enter) to open a scrollable native dialog listing everyone in that slot, including full names. Escape or Close dismisses it. Hovering a label shows its full name and role. Fixed-height cell contents keep crowded slots from expanding the grid. The weekly calendar scrolls horizontally and vertically, with sticky day headings and a sticky time column.

Refresh uses the existing single data-loading operation (including pagination when required), then rebuilds the calendar, legend and detailed table from those same results. There are no per-person or per-slot queries. Switching away from Coach clears all views and cancels pending loading. No schema/configuration changes are needed beyond the previously documented dashboard SELECT migration.

### Test overlaps

1. Submit student Kaif for Monday 17:00–19:00 and coach Alice for Monday 18:00–20:00. Choose Coach and click Refresh.
2. Kaif should appear alone at 17:00/17:30. Alice (bold with C) and Kaif should both appear at 18:00/18:30, with Alice first. At 19:00/19:30 only Alice should appear; 20:00 must be empty.
3. Add enough submissions overlapping 18:00 to exceed three people. Verify **+N more** opens a complete sorted list and that Escape/Close works without changing any availability.
4. Verify each person's legend color matches every label. Refresh/reload and confirm colors are stable. Expand Detailed view to compare stored ranges.
5. Narrow the browser and scroll horizontally; time labels should stay visible. Select Student and verify the entire dashboard disappears. Verify the original selection grid and submission still work.
