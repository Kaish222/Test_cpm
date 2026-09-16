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
10. In Supabase **Table Editor**, find the test name in `people` and copy its `id`. Filter `availability` by that `person_id`: expect Monday `17:00:00–18:30:00` and Wednesday `14:00:00–14:30:00`. The dashboard has privileged access; the website cannot list records.

The Data API must be enabled with the `public` schema exposed (the usual new-project default). Keep the frontend files together in the GitHub Pages published directory. All local script paths are relative, including on repository subpaths. The Supabase CDN client uses the supported v2 channel and is the only external library.

## Files and submission flow

- `index.html`: existing form and ordered deferred scripts: Supabase CDN, config, API wrapper, then grid.
- `style.css`: existing UI, plus disabled-control feedback.
- `script.js`: grid, merging, validation and save-state UI. Controls are temporarily locked so the displayed selection matches the submitted snapshot. The selection stays after saving.
- `supabase-config.js`: two public configuration values.
- `supabase-api.js`: lazy client initialization, row conversion, one RPC call, 20-second timeout and error propagation.
- `supabase-schema.sql`: initial schema, RLS and atomic insert function.

`buildAvailabilityData()` still produces `{ name, role, availability: { monday: [{ start, end }] } }`. The API wrapper flattens ranges into `{ day, start_time, end_time }` rows. The SQL function generates a UUID, inserts the person with it, then inserts all ranges in one batch using that `person_id`. It returns only the newly created UUID, without selecting table rows.

## Atomicity and retries

Two separate browser requests cannot share a database transaction. If person creation succeeded and availability failed, browser cleanup would be unreliable: anonymous deletion is forbidden and the connection could disappear.

This version therefore includes one small PostgreSQL RPC function now. It is a database function, not an Edge Function or separate backend server. Both inserts execute in one transaction; a bad availability row rolls back the person and the entire batch. **SECURITY INVOKER** respects the caller's grants and RLS.

The submit handler prevents duplicate in-flight saves. There are no automatic retries. A timeout or lost response can happen **after** commit, so an error may mean the result is unknown. Check Table Editor before retrying. Submitting again after success, using another tab or reloading and submitting creates a new person; cross-request deduplication is not implemented.

## Temporary anonymous-access security

A public publishable/anon key is expected in browser JavaScript. Database grants, RLS and constraints provide protection; the key does not identify a trusted person. Never use a privileged key to fix a permissions error.

Both tables have RLS and **INSERT-only** anonymous policies with limited column grants. There is no anonymous SELECT, UPDATE or DELETE privilege. The RPC returns only the UUID it just created. This setup grants no table access to `authenticated`; authentication is outside this version.

Anyone can copy the public key and submit arbitrary valid names/roles or spam inserts. There is no identity verification, ownership enforcement, CAPTCHA or application rate limiting. The requested direct INSERT access also allows a caller to bypass the RPC, insert a person without availability, or attach availability to a known person's UUID. Atomicity protects this application's RPC flow, not arbitrary direct API writes. Monitor usage and treat these permissions as temporary prototype settings.

Constraints reject invalid weekdays/roles, empty or overlong names, duplicate exact ranges and invalid times. Slots must align to half hours within 08:00–22:30. Deleting a person through privileged dashboard access cascades to their availability.

## Checks and troubleshooting

- Empty name, missing role or no selection: inline validation and no request.
- Rapid double-click: only one in-flight save. Inputs and selection survive both success and failure.
- Browser Developer Tools → Network: expect one POST to `/rest/v1/rpc/submit_availability`, returning a UUID. There should be no table read request.
- Errors: the browser console has debugging details. Check configuration, CDN connectivity, SQL setup, Data API exposure, INSERT policies and RPC grants. Do not grant SELECT or disable RLS as a workaround.
- Test rollback in **SQL Editor** using a distinctive name and a backwards range:

  ```sql
  select public.submit_availability(
    'ROLLBACK_TEST', 'student',
    '[{"day":"monday","start_time":"18:00","end_time":"17:00"}]'::jsonb
  );
  ```

  Expect an error. In a **separate query**, run `select * from public.people where name = 'ROLLBACK_TEST';` and expect zero rows. Choose a fresh test name if it already exists.
- Check anonymous access from SQL Editor: `begin; set local role anon; select * from public.people; rollback;` must fail with permission denied. If the editor leaves the failed transaction open, run `rollback;` separately. Repeat for `availability`; UPDATE and DELETE should likewise fail.

Frontend checks can use a mocked Supabase client. Real SQL execution, RLS enforcement, successful persistence and rollback must be verified in your configured project; placeholder credentials cannot establish a live connection.

References: [browser client](https://supabase.com/docs/reference/javascript/installing), [database functions and privileges](https://supabase.com/docs/guides/database/functions), [public and secret API keys](https://supabase.com/docs/guides/api/api-keys).
