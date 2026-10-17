# Increment B: final review (Task B10)

Date: 2026-10-18. Branch `feat/b10-hardening` on top of the stack: #40, then #41 (B5), #42 (B6, 0016), #43 (B7, 0017), #44 (B8, 0018), #45 (B9, 0019).
Scope: B1-B9, migrations 0013-0019. Fixes ship as small commits on this branch, with one new migration (`0020_increment_b_hardening.sql`). Migrations 0016-0019 are left unchanged so their checksums stay stable.

Severity: **Critical** means data exposure or loss that can happen now. **Important** means a security or spec violation, or a broken flow. **Minor** means defence in depth, polish or debt.

## Checklist result

### 1. Migrations 0016-0019 (+0020)

No local Postgres or Docker was available, and no remote database was touched. The migrations were checked by careful reading plus SQL-text unit tests. The new `tests/unit/migrations-invariants.test.ts` checks the following for every migration from 0013 on:
- every new table enables and forces RLS;
- every SECURITY DEFINER function pins `search_path` with `pg_temp` last, is owned by `paranaga_definer` and is revoked from PUBLIC;
- schema CREATE granted to the definer role is revoked again.

| Item | Result | Where |
|---|---|---|
| Syntax and names against 0000-0015 and `schema.ts` | pass (read) | Policy subqueries reference outer columns correctly (`post_id`, `correction_id`, `complaint_id`). No PL/pgSQL OUT-parameter and column name conflicts were found. Types in `RETURNS TABLE` match. |
| Forced RLS on every new table | pass | 0016 `:63-66`, 0017 `:131-144`, 0018 `:151-158`, 0019 `:36-37` (unit test) |
| Definer functions: pinned search_path, owner, revoke/grant | pass | All functions in 0016-0019 (unit test) |
| Schema CREATE left granted to `paranaga_definer` | **fixed** (Important) | 0016 `:13` and 0017 `:16` never revoked it. 0020 revokes it. |
| Moderator can dismiss reports on their own content | **fixed** (Important) | 0017 `report_queue`/`resolve_report`. 0020 filters and refuses these. |
| Ordering: `core.media_object` definer policies | **open, owner action** (Important) | The B4 functions in 0015 run as `paranaga_definer`. That role had no grant or policy on `core.media_object` until 0018 `:160-169`, so B4 slot/confirm cannot work on production (0013-0015 applied) until 0018 is applied. B6 photo evidence (0016 `submit_correction`) also needs 0018. **Apply 0016-0020 together, in one release.** |
| Duplicate grants | Minor | `grant usage on schema community` appears in 0016 and 0017. `grant select on transit.revision to paranaga_definer` (0016 `:73`) repeats 0001. Both are harmless. |
| Idempotence | pass | Each file runs once under `scripts/migrate.ts` (checksummed). `create or replace` keeps owners and grants. |

What the CI `database` job must prove (`pnpm db:migrate`, then `pnpm db:check-rls`, then `pnpm test:integration` on a fresh Neon branch):
- 0000-0020 apply in order;
- `check-rls` finds no unforced table, no unpinned definer function and no PUBLIC execute;
- `tests/integration/{rls,priv-complaint-rls,community-rls,external-handoff-rls,saved-media-rls}.test.ts` pass.

Note: `.github/workflows` runs the `database` job only on push (`github.event_name != 'pull_request'`). The new integration tests are therefore first exercised when the stack lands on master (see "Owner decisions").

### 2. Multi-role IDOR/RLS matrix

| Area | Guest | Owner | Other commuter | Contributor | Community moderator | Transport reviewer | Complaint reviewer | Admin | Test |
|---|---|---|---|---|---|---|---|---|---|
| `community.correction*` (direct read) | none | own | none | none | none | none | none | none | community-rls |
| Correction review queue / status | refused | refused | refused | refused | refused | yes (not own) | refused | yes | community-rls |
| `community.post*` pending | none | own | none | none | none | none | none | none | community-rls |
| `community.post*` published | read | read | read | read | read | read | read | read | community-rls |
| Content queue / publish | refused | refused | refused | refused | yes (not own) | refused | refused | yes | community-rls |
| Reactions, bookmarks, blocks, own reports | none | own | own | own | own | own | own | own | community-rls |
| Report queue / resolve | refused | refused | refused | refused | yes (not own, 0020) | refused | refused | yes | community-rls |
| `priv.complaint*` | none | own | none | none | none | none | definer functions only, with step-up | none | priv-complaint-rls, community-rls |
| `priv.external_handoff` | refused | own | no row | n/a | no row | n/a | no row | no row | external-handoff-rls (new) |
| `core.saved_*` | none | own | none | n/a | none | n/a | n/a | none | saved-media-rls (new) |
| `core.media_object` | refused | own | none, cannot confirm | n/a | none | n/a | n/a | none | saved-media-rls (new) |

API level:
- **fixed** (Important): community `guarded()` mapped 42501 to 403, which exposed whether a post exists. It now returns 404 (`src/server/community/handlers.ts`).
- **fixed** (Important): media confirm returned a different message for "not yours" and "missing". Both now return the same 404.

### 3. Cache and secret scan

| Item | Result | Where |
|---|---|---|
| SW never caches `/api/v1/me/**`, complaints, media, `evidence-private`, signed URLs, community and auth | pass | `src/domain/pwa/sw-routes.ts` (`PRIVATE_DATA`, allow-list only), `src/app/sw.ts` matcher, `tests/unit/sw-private.test.ts` |
| Every route handler authorizes first and returns the error envelope | **fixed** (Important) | `media/slots`, `media/confirm` and `me/saved-places`/`me/saved-trips` ran outside `authedRoute`, so no session or a bad body produced a framework 500. All four now use `authedRoute`. |
| Error bodies never echo internals | **fixed** (Important) | `media/confirm` returned `badRequest(err.message)`, which included DB text and the slot status. It now returns fixed messages. |
| Cache-Control | pass | Authenticated responses use `no-store` or `private, no-store`. The public feed has `s-maxage=30` only for viewer-less requests (`src/server/community/read.ts`). |
| Cron secret only in the Authorization header, constant-time | pass | `src/app/api/cron/jobs/route.ts` |
| No secrets, tokens or private text in logs, URLs or bodies | pass | Logs carry the event, route, request id and error class only. Signed evidence URLs last 60 s, are returned in the JSON body and are not cached. |
| `pnpm check:bundle-secrets` | see PR body | Run after the e2e build. |

### 4. Privacy

| Item | Result | Where |
|---|---|---|
| Complaint text never reaches Jev | pass | `mayClassifyWithJev` requires `JEV_COMPLAINTS_ENABLED` (default off) and legal clearance. Legal clearance is hard-coded false in both callers. The complaints handler never calls Jev. |
| Only masked text goes to Jev | pass | `maskForAi` is used in `community/moderate.ts` and `corrections/handlers.ts`. |
| No complaint text in logs or audit | pass | `core.audit` payloads carry counts and statuses only (0018/0019). |
| EXIF/GPS | **fixed** (Critical) | `confirmMediaSlot` copied uploads to `public-media` byte for byte. Correction photos are a raw `File` with EXIF and GPS. Everything bound for `public-media` is now image-only, and EXIF, XMP, GPS, IPTC and comments are stripped server-side (`src/domain/media/strip-metadata.ts`). Orientation is kept. Complaint evidence stays an untouched original. |
| Media storage keys | **fixed** (Important) | Keys were `purpose/sha256`, which is UNIQUE. A second upload of the same bytes hit 23505 after the quarantine copy had already been deleted, so the upload was lost. It also overwrote the other user's object. Keys are now per slot. The promote runs before the quarantine delete. |
| Rate limits on every write | **fixed** (Important) | Media slots/confirm and the saved-* POSTs had no limit. They now have `mutationPerMinute`, plus `mediaSlotPerHour` (30) for slots. Minor gap: community DELETEs and unblock have no limit (backlog). |

### 5. Accessibility and design

- **fixed** (Important): the sign-in input set `outline: none`, so the focus ring was too faint. It now has a `:focus-visible` outline.
- **fixed** (Important): "Use a different email" dropped focus to body. Focus now returns to the email field. Errors use `role=alert`, and the code field has `autocomplete=one-time-code`.
- **fixed** (Important): the Settings account action (Sign in / Sign out) was about 31 px tall. It is now at least 44 px.
- pass: wizards focus the step heading. Reduced motion is covered by the global catch-all (`globals.css`). New CSS uses `--pn-*` tokens for light, dark and high contrast. Dialogs are native `<dialog>` with `aria-labelledby`. Live regions are present.
- e2e (mobile project, fresh build, PORT=3531): community, my-reports, report-correction, report-driver, settings, shell and reflow. Results are in the PR body.

### 6. Copy honesty

- pass: there are no user-facing "ETA", "live", "arriving", "e-jeep", "real-time" or tricycle/padyak minute counts. "live" appears only in identifiers and comments. Estimates are labelled "Est."/ranges.
- pass: community content is labelled "Community observation", and pending content says "Awaiting review". Report detail, handoff and MyNaga screens say ParaNaga does not send anything to MyNaga or City Hall.
- **fixed** (Important): the driver report said "not sent to Naga City ... automatically", which implies it might be forwarded later. It now says "ParaNaga does not send it to Naga City" (`notice.ts`, `report-driver/page.tsx`, `i18n/messages.ts`).
- **fixed** (Important): with no auth service, the sign-in screen showed "code sent" and "Signed in successfully (test mode)" and redirected. It now says sign-in is not available and that the app works as a guest.

### 7. Known open items from the task agents

| Item | Decision |
|---|---|
| Step-up for the reporter's own evidence download, and for reviewer functions | **Recorded, not built.** The reviewer functions call `priv.require_step_up()`, which fails closed: nothing sets `app.step_up_at`, so the complaint reviewer flow is unusable until the OTP step-up exists. The reporter's own original download has **no** step-up yet (spec 05 §5.8 asks for one; TODO in 0018 `my_evidence_download`). Build the step-up as one task: verify a fresh OTP, then `set_config('app.step_up_at', …, true)` in the same transaction. |
| Jev wire format | **Recorded.** No real recorded Jev response exists in the repo (only mocks in `tests/unit/jev-client.test.ts`), so no fixture test was added. `WireResponse` is `.strict()`, so any extra field turns every answer into `malformed`. That is safe, because content stays pending, but Jev would be silently useless. Record one real response before relying on it. |
| In-memory Jev budget per instance | **fixed** (Important). The default budget is now one `ops.take_token` bucket per UTC day, shared by all instances, and it fails closed. |
| CSP connect-src for object-storage uploads | **fixed.** `connect-src` adds `new URL(STORAGE_ENDPOINT).origin` when set (spec §5.10 lists the storage host). The policy is still Report-Only. |
| Storage key uniqueness on duplicate uploads | **fixed** (see 4). |
| `media-src blob:` CSP | pass (already present, `next.config.ts`). |
| CI integration RLS test for `priv.external_handoff` | **added** (`tests/integration/external-handoff-rls.test.ts`). |

## Owner decisions

1. **Release order:** apply 0016-0020 together. B4 upload confirm is broken on production until 0018's `core.media_object` definer policies land.
2. **CI `database` job on pull requests:** it is skipped on PRs today, so the five RLS suites first run after merge to master. Consider running it on PRs into master, or run it manually for this stack before merging.
3. **Step-up OTP:** until it is built, complaint reviewers cannot work, and reporters download originals without step-up. Decide whether to keep reporter downloads open or gate them off until step-up exists.
4. **Display copies:** spec §5.8 asks for re-encoded WebP (≤1600 px, `sharp`) and review before anything reaches `public-media`. This branch strips metadata but does not re-encode, and unreviewed correction photos still land in `public-media` (not served anywhere yet). Decide: (a) add `sharp` as a direct dependency and re-encode, and/or (b) keep correction evidence out of `public-media` until a reviewer approves it.
5. **Corrections sent to Jev** as `kind: "community"` (masked free text). Confirm this is wanted.

## Minor backlog

| Severity | File:line | Problem | Suggested fix |
|---|---|---|---|
| Minor | `db/migrations/0016_community_correction.sql:69` | The author can read `community.correction_event.actor_id` (the reviewer's id) at DB level. The API does not return it. | Column grant without `actor_id`, as in 0018. |
| Minor | `db/migrations/0017_community_hub.sql:146` | `community.post.author_id` is readable by the app role for published posts (the API maps it to a handle). | Column grant or a view that exposes only `community.handle(author_id)`. |
| Minor | `db/migrations/0017_community_hub.sql:21` | `community.handle` uses 5 hex digits. Collisions become likely after about 1k users, so two people can show the same handle. | Use 6-8 characters. |
| Minor | `db/migrations/0016_community_correction.sql:236` | `set_correction_status` records `actor_role = 'transport_reviewer'` even for admins. | Record `admin` when the actor is not a transport reviewer. |
| Minor | `db/migrations/0018_priv_complaint.sql:327,401` | The evidence downloads hard-code bucket `'evidence-private'`, while the app uses `STORAGE_BUCKET_EVIDENCE`. | Drop the bucket filter or pass it in. |
| Minor | `src/domain/complaints/status.ts` / 0018 | `withdrawn` exists, but no function lets the reporter withdraw. | Add `priv.withdraw_complaint` when the UI needs it. |
| Minor | `src/server/storage/adapter.ts:127-160` | The presigned PUT signs only `host`, so size and content-type are not enforced at upload. The HEAD check before buffering now limits the impact. | Presigned POST with `content-length-range`, or sign `content-length`/`content-type`. |
| Minor | `src/server/media/service.ts` | No container parse for complaint videos (spec §5.8). Sniffing reads the first 12 bytes only. | Add an MP4/WebM box parse. Serve with `nosniff` and the right content-type. |
| Minor | `src/domain/pwa/sw-routes.ts` `PRIVATE_DATA` | `community`, `corrections` and `auth` are protected only by the allow-list default. | Add them to the regex for defence in depth. |
| Minor | `src/server/community/handlers.ts` (delete post/comment, unblock) | No rate limit on these DELETEs. | `mutationPerMinute`. |
| Minor | `src/app/api/cron/jobs/route.ts:24` | `serverEnv()` runs outside the try, so a bad env gives a raw 500. | Move it inside the try. |
| Minor | `src/server/adapters/jev/client.ts` | `JEV_DECISIONS_URL` accepts `http:`. `maskForAi` covers only emails, phones and plates. | Require https. Widen masking (handles, addresses). |
| Minor | `src/ui/report/report-wizard.tsx:443`, `src/ui/report-driver/driver-report-wizard.tsx:543`, `src/ui/community/post-composer.tsx:269`, `src/ui/community/post-thread.tsx:508,580` | Field errors are announced (`role=alert`, they name the field) but have no `aria-invalid`/`aria-describedby`. | Link each error to its field. |
| Minor | `src/ui/report/report-wizard.tsx:203`, `src/ui/report-driver/driver-report-wizard.tsx:288` | "Step N of M" is not part of the focused heading. | Include it in the heading or use `aria-describedby`. |
| Minor | `src/ui/report/report-wizard.tsx:211`, `src/ui/report-driver/driver-report-wizard.tsx:331`, `src/ui/community/post-composer.tsx:202`, `src/ui/community/post-thread.tsx:563` | `role=radiogroup` is nested in a fieldset with a legend. | Drop one of the two. |
| Minor | `src/ui/report/report-wizard.tsx:373,374,472`, `src/ui/community/post-thread.tsx:120`, `src/ui/community/community-feed.tsx:169` | Upload, sending and loading progress, and filter results, are not in a live region. `aria-disabled` is set on a label. | Add a `role=status` region. Remove the `aria-disabled`. |
| Minor | `src/ui/report-driver/camera-capture.tsx:88`, `src/ui/community/post-thread.tsx:400-431` | Repeated control names ("Retake", "Reply", "More") have no item context. | Add the item to the accessible name. |
| Minor | `src/ui/reports/reports-screen.tsx:74`, `src/ui/community/community-feed.tsx:178` | `role=alert` wraps a "Try again" button. | Put the alert on the text only. |
| Minor | `src/ui/community/community.css` `.pn-comm__tag` | Short tags are under 44 px wide. | `min-width: 44px`. |
| Minor | `src/ui/community/community-feed.tsx:254` | The "unverified" notice appears once, after the list. | Move it above the list. |
| Minor | `src/ui/mynaga/mynaga-screen.tsx:3-9`, `src/ui/help/help-screen.tsx:6-13` | Stale code comments say the driver report does not exist yet. | Update the comments. |
| Minor | `src/server/api/http.ts` / `src/app/api/v1/media/confirm/route.ts` | The "rejected" message is generic for photos and videos. | Purpose-specific copy if users get confused. |
