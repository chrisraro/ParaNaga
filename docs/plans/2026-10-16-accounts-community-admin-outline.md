# Outline: accounts, contributions and community (Increment B) and the admin console (Increment C)

Status (2026-10-22): partial. The Increment B half is superseded by 2026-10-18-accounts-community-plan.md; the Increment C half (admin console) is not started and its migrations are renumbered from 0022 (the repo has 0001 to 0021); see docs/spec/07-delivery.md section 7.11 (N5 to N7).

Date: 2026-10-16 · Status: outline, to be expanded into task-by-task plans (format of `docs/plans/2026-10-15-data-and-provisional-planner.md`) once the open questions at the end are answered.
Depends on: Increment A (`docs/plans/2026-10-16-commuter-screens.md`) — UI kit, tab bar, device storage, service worker allow-list.
Spec: `02-features.md` (F-C1, F-D1–F-D5, F-E1–F-E17), `03-architecture.md` (§3.5 RLS, §3.8 Jev pipeline, §3.9 storage, §3.10 jobs), `04-data-model.md` (§4.2 core, §4.5 community, §4.6 state machines, §4.8 priv, §4.9 ops), `05-security.md` (all), `06-screens.md` (S16–S21, A1–A21), `07-delivery.md` increments 5–7.
Artboards: `.superpowers/sdd/design-all/project/` `SignIn`, `ReportCorrection`, `ReportDriver`, `MyReports`, `MyNagaHandoff`, `Community`, and the 21 `Admin*` boards (shared shell: left nav groups Overview · Transport data · Publishing · Community & reports · System).

The global constraints of the Increment A plan apply unchanged. Additional constraints for B and C:
- Every Route Handler and Server Action starts with `authorize(action, resource)` (`src/server/auth/authorize.ts`), then runs its queries in `withRequestContext({ userId, requestId })`; RLS is the second wall. Server Actions are public endpoints: Zod `.strict()` input, body caps (§5.6).
- Writes to protected state go through small `SECURITY DEFINER` functions owned by `paranaga_definer` (definer lint: pinned `search_path … pg_temp`, `EXECUTE` revoked from `PUBLIC`, no identity parameters, audit insert in the same transaction). `paranaga_app` gets no direct DML on `community.*` decisions, `priv.*` or `transit.*`.
- Every new table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, explicit grants and per-role policies, indexed policy columns; `pnpm db:check-rls` passes (extend it to views — §7.8 follow-up — before C).
- Nobody reviews their own submission (service + RLS). Role grants audited, no self-grant.
- Jev is evidence, never authority: typed answers through the pinned dated build (`JEV_MODEL_ID`, refuse aliases at startup), `applyModerationPolicy()` decides, any failure keeps content pending, Jev never sees images, complaint text never sent while `JEV_COMPLAINTS_ENABLED=false`.
- Service worker: authenticated APIs, `/account/**`, `/admin/**`, RSC and `private` responses are never cached; sign-out clears account-linked IndexedDB stores and non-public caches (§3.11).
- Secrets only in Vercel/GitHub env; never printed; `check:bundle-secrets` extended with `sk-or-`, storage key names.

---

## Increment B — accounts, corrections, community, driver reports

### Schema migrations

| Migration | Contents |
|---|---|
| `0005_core_account_data.sql` | `core.saved_place`, `core.saved_trip` (`legs jsonb`, `revision_id`, `invalidated_at`, `invalidation_reason`), `core.trip_history` (labels only, 90-day retention); owner-only RLS (`user_id = core.current_user_id()`); `core.ack` already exists (kinds `community_guidelines`, `driver_report_notice`, `ai_processing_disclosure`). |
| `0006_ops_jobs_ratelimit.sql` | Claim function for `ops.job` (`FOR UPDATE SKIP LOCKED`, lease, heartbeat), `ops.take_token(key_hash, window, limit)` definer function (one upsert per key per window), purge of old windows; `ops.provider_health` writes; seed `ops.moderation_policy` `paranaga-community-v1` (inactive thresholds until calibrated). |
| `0007_community.sql` | `community.post`, `post_version`, `comment`, `comment_version` (depth ≤ 2), `reaction`, `bookmark`, `user_block`, `content_report`, `correction`, `correction_event`, `jev_evidence`, `moderation_decision` (+ join table for evidence ids), `appeal` (unique per decision), `user_restriction`, `changelog_entry`; join table `post_version_media`. Definer functions: `submit_post_version`, `submit_comment_version`, `submit_correction`, `apply_moderation_decision` (binds to `target_version_id`, no-op if already decided, promotes version), `record_appeal`, `resolve_appeal`. Public views: published posts/comments only, author shown as display name. |
| `0008_priv_complaints.sql` | `priv.complaint` (random `public_ref` `PN-XXXX-XX`), `complaint_media`, `complaint_event` (`visibility` reporter/reviewer_only), `evidence_access`, `external_handoff`, `jev_complaint_evidence`; `priv.v_complaint_review` (omits `reporter_id`); definer functions `submit_complaint`, `withdraw_complaint`, `record_handoff_event`, `issue_evidence_url` (audited, 60 s), `break_glass_reveal_reporter`; `legal_hold`; no grants to `community_moderator`. |
| `0009_media.sql` | Extend `core.media_object` usage: slot creation/confirmation definer functions bound to `owner_id` + `purpose` + `expected_bytes`; orphan-sweep job kind. |

### Tasks (outline)

1. **Sign-in (S21, F-C1) — Neon Auth (Managed Better Auth).** `/app/sign-in` per artboard `SignIn` (copy: "An account is optional. Everything in ParaNaga works as a guest, and your saved trips stay on this phone."), email one-time link/OTP and the OAuth providers the user approves (Q-B1); `getCurrentUser()` already creates the profile + `commuter` role via `core.ensure_commuter`. OTP rate limits configured in Neon Auth (5/hour/email, 20/hour/IP) and verified. More screen gains "Sign in" / account card, display name edit, sign-out (clears account stores), data export (JSON) and account deletion (both behind step-up). Proxy matcher keeps `/account/**` and `/admin/**`. Tests: e2e sign-in on a preview with a test inbox or Neon Auth test mode; session rotation on role change; IDOR tests.
2. **Account sync of saved items** (only if Q-B2 = yes): `/api/v1/me/saved-*` (private, `no-store`), merge device items on first sign-in with user confirmation; device copies remain the offline source.
3. **Rate limiting + job runner.** `src/server/ratelimit/` on `ops.take_token` (keys: `sha256(ip|ua-family)` for guests, user id for members) applied to `/api/v1/plan` (30/min, 600/day — the §7.8 follow-up) and every new write; `src/server/jobs/` claim/commit-before-I/O loop, `/api/cron/jobs` (`CRON_SECRET`), opportunistic drain via `after()`, dead-letter. Trigger cadence depends on Q-B6.
4. **Uploads (Neon Object Storage).** `StoragePort` + S3 adapter (`@aws-sdk/client-s3`, presigner) on buckets `quarantine`, `public-media`, `evidence-private`; verify at implementation whether Neon storage supports presigned POST policies (else PUT + post-upload size check); slot → upload → confirm by slot id → HEAD, magic bytes, `sharp` decode, SHA-256, ≤ 8 000 px → copy to server-owned key → delete quarantine object; HEIC converted on the client; video (driver reports only) MP4/WebM ≤ 30 s / 25 MB parsed with a JS container parser; `media_derivatives` job (EXIF/GPS strip, WebP ≤ 1600 px). Bucket CORS allow-list = app origins. CSP `connect-src` + `img-src` add the storage host. Tests: cross-user confirm rejected, overwrite-after-verify impossible, no EXIF GPS in public copies.
5. **Jev adapter and moderation pipeline (§3.8).** `src/server/adapters/jev/` (Decisions API contract re-checked at implementation, recorded fixtures for valid / missing / extra / wrong-type / out-of-range answers and 401/402/404/429/5xx/timeout), state sanitizer (NFC, length caps, control/zero-width strip, email/phone/plate masking), pinned build check per response, circuit breaker, daily budget; pure `src/domain/moderation/policy.ts` (`applyModerationPolicy`, thresholds by version, `AUTO_PUBLISH_ENABLED=false` → everything not high-certainty-reject goes to humans); deterministic pre-checks (rate, SimHash duplicate ≥ 0.9, link allow/deny list, length, language hint); job kinds `moderate_submission`, `image_safety` (`HumanReviewOnly`); `scripts/replay-policy.ts`; `pnpm jev:smoke` (opt-in, synthetic text, never CI).
6. **Report a correction (S16, F-D1).** Wizard per artboard `ReportCorrection` (3 steps: What's wrong → Tell us what you saw → Review and send; choices "Wrong curb side", "Stop is in the wrong place", "Route doesn't stop here", "Signboard text is different", "Fare is wrong", "Stop is no longer used", "Something else"), entity reference + revision prefilled, similar submissions first ("Add my evidence to this"), optional location (accuracy shown, removable), optional photos (Task 4), AI-processing disclosure before the first submission (`core.ack`), status page with the 10-state timeline (§4.6). Entry points replace the Increment A "opens soon" notes: stop detail ("Help verify this stop"), route detail, trip detail, place detail, Arrive ("Was this guidance helpful?" → "Tell us what was off"). Requires role `contributor` (granted after email verification + 24 h, configurable). Nothing changes published data until review + publication [AC-13]. "My corrections" list.
7. **Community (S17, F-D2).** Tab "Community" added to the tab bar. Feed per artboard `Community` (topics, labels Official notice / Community observation / Incorporated change, helpful, bookmark, comments), post detail with 2-level comments, report content, block author, guidelines acknowledgment (verbatim brief §9B text already in `src/i18n/messages.ts`, versioned), compose (category, context chips route/stop/barangay, text ≤ 4 000, photos), "Pending review" state, my submissions with templated rejection reasons, revise & resubmit, one appeal per decision. Identifying allegations against drivers → human review + pointer to the private report. Edits create a new pending version; the published version stays live.
8. **Report a Driver (S18, F-D4).** Five steps: explainer (privacy, safety, "not sent to Naga City automatically", emergency 911, unlocked-phone warning) → camera capture on tap (`getUserMedia`, rear camera, photo / ≤ 30 s video, retake/remove/add) with "Upload a photo instead" and "Continue without photo" → details (categories Overcharging, Reckless driving, Discount refused, Harassment, Improper loading/unloading, Other; factual description ≤ 2 000; incident time separate from capture time; location GPS/manual/none; route/direction; operator; plate/body number with "I don't know") → acknowledgment (verbatim brief §9D, already in messages) → review → "Submit privately" → receipt with reference. Drafts only in IndexedDB (`reportDrafts`, media as Blobs; cleared on submit, cancel, sign-out). Deterministic routing to `queue_normal` / `queue_priority` / `queue_check_completeness`; Jev complaint classification stays off. In-app notification centre for reporter-visible status changes; optional email "Your ParaNaga report {ref} has an update" (no details).
9. **My reports (S19) and MyNaga handoff, report-bound (S20, F-D5).** List per artboard `MyReports` with status chips and the separate "MyNaga · self-reported" panel; the `/app/mynaga` page from Increment A gains the report-bound steps: copy summary (formatted deterministically from form fields), redacted evidence download by default (original only after the metadata/bystander warning and step-up), Web Share, verified links, "I submitted it in MyNaga" switch + optional reference (≤ 64 chars, plain text, self-reported, never sent to Jev). Records `handoff_started` / `submitted_externally` only; ParaNaga status never changes from a click [AC-15].
10. **Verification + security pass for B.** IDOR suite (user B vs user A: saved items, corrections, complaints, media slots), moderator cannot read `priv`, forged/empty `app.user_id` sees nothing private, pooled-connection leak test, SW Cache Storage inspection after an authenticated session, Jev failure matrix keeps content pending, rate limits enforced, `ecc:security-reviewer` + `ecc:database-reviewer`.

### Security checks specific to B
- Session cookies HttpOnly/Secure/SameSite=Lax; roles only from `core.user_role`; step-up (fresh OTP ≤ 15 min) for export, deletion, original-evidence download.
- Signed evidence URLs ≤ 60 s, JSON body, `no-store`, `Referrer-Policy: no-referrer`, never logged or put in HTML; one `priv.evidence_access` row per issuance.
- `core.audit_event.before/after` never holds free text or `priv` personal data.
- Logs never contain post text, complaint descriptions, coordinates, tokens.
- CSP: `camera` only used on the driver-report route; storage and auth hosts added to `connect-src`.

---

## Increment C — admin console (21 screens)

Shell: `/admin` (desktop-first, responsive to tablet; the `PhoneOnlyGate` does not apply), role-gated in the layout (`getCurrentUser()` + per-page `authorize`), privileged sessions re-authenticate after 12 h, left nav as in the artboards. The artboards' footer chip "data_editor · admin" is a placeholder: the real roles are the six in `src/domain/auth/permissions.ts`. Each nav item is shown only when the user's roles allow it (no dead links); "Complaint review" and "Users & roles" show a lock state until step-up.

### Prerequisites (before any editing screen)
- **Draft revision editing model:** definer functions to create a draft from the published revision (copy membership), insert new `*_version` rows and repoint membership; published rows never edited in place (§4.4, final-review note). Includes making stable natural keys editable via versions where the final review flagged it (R1–R7 metadata).
- **Changed-data importer** (§7.8 "still blocks"): import of a new My Maps snapshot into a new draft revision with diff (`added/changed/missing`) and lineage, required for A2 Imports beyond the first run.
- **Step-up**: fresh Neon Auth OTP within 15 min for publish/rollback, role grant/revoke, complaint unlock/evidence access, threshold change (verify Neon Auth supports re-verification; otherwise a server-side OTP challenge record).
- `check-rls` extended to views; reader-role ownership of public views (§7.8 follow-up).

### Schema migrations for C

Renumbered 2026-10-22: the repo already has migrations 0001 to 0021 (Increment B and hardening took 0010 to 0021), so C starts at 0022. Update (N3): 0022 is now `0022_step_up.sql`, so C starts at 0023 and every number below shifts by one. Re-check the number before writing each file.

| Migration | Contents |
|---|---|
| `0022_transit_evidence.sql` | `transit.evidence`, `transit.evidence_link` (one nullable FK per target, `num_nonnulls = 1`, claim/target compatibility), photo redaction metadata (`media_object` link, boxes, `redaction_reviewed_by`). |
| `0023_transit_geometry.sql` | `transit.shape_version` (LineString, `length_m`, `evidence_kind` legal_plan_trace/gps_ride_log/surveyed, reviewer), `transit.stop_area`, curb fields already on `stop_point_version` + `road_segment_ref`, `transit.walk_edge`, `transit.barrier`, `transit.reconciliation_decision` (group, rule, distance, link/keep_separate, note, reviewer). |
| `0024_transit_terminals_service.sql` | `terminal_version` (location evidence, compound polygon), `terminal_entrance`, `terminal_bay` + route assignment, terminal hours with evidence; `transit.service_window` (day type weekday/saturday/sunday_holiday, first/last seen, dispatch model, headway range, confidence); `transit.disruption` (`active tstzrange` with `CHECK (NOT upper_inf(active))`, title en/fil/bcl, scopes, replacement note, evidence); `expire_disruptions` job. |
| `0025_transit_fares.sql` | `transit.discount_rule` (mode scope, categories, rounding), `transit.fare_matrix_row`, fare conflict resolution fields, `EXCLUDE` overlap backstop on verified versions. |
| `0026_ops_admin.sql` | Indexes and read views for queues (corrections, moderation, appeals, complaints, jobs, audit filters), `ops.provider_health` writer, alerting hooks (rate-watch of complaint opens: > 30/day/reviewer). |

### Screen groups → tasks, tables, permissions

| Task | Screens (artboard) | Tables / functions | Permission (`authorize`) |
|---|---|---|---|
| C1 Shell + dashboard | A1 Dashboard | counts from queues, `revision`, `coverage_audit`, `ingest.batch`, `ops.provider_health`, `ops.job` | any staff role (cards filtered by role) |
| C2 Imports | A2 Imports | `ingest.*`, changed-data importer, `import_batch` job | `transit.revision.edit` |
| C3 Candidates + stops/curbs + reconciliation | A3 Candidate review, A6 Stops & curbs, A7 Reconciliation | `stop_point_version`, `evidence`, `evidence_link`, redaction, `reconciliation_decision`; promotion needs evidence of the claimed kind; "Approve for navigation" checklist incl. second editor | `transit.revision.edit` |
| C4 Routes + shape editor | A4 Routes & variants, A5 Shape editor | `variant_version`, `route_alias` (with source), trial status + expiry/review date, `shape_version`; OSM roads as drawing aid only; validation (disconnected, out-of-bbox, U-turn spikes) | `transit.revision.edit` |
| C5 Terminals | A8 Terminals | terminal versions, entrances, bays, hours (save disabled until evidence with a shape/hours claim) | `transit.revision.edit` |
| C6 Fares | A9 Fares | fare rule versions, discount scopes, matrix import (CSV `km_from, km_to, regular_centavos, discounted_centavos`), F05 conflict resolution; conflicted rules cannot be verified | `transit.revision.edit` |
| C7 Service windows + disruptions | A10, A11 | `service_window`, `disruption` (end required), expiry job; commuter copy "Trips seen from … to …" (past tense, catalog) | `transit.revision.edit` |
| C8 Revisions + coverage | A12 Revisions & publication, A13 Coverage audit | publication validation report (every F-E rule), diff vs published, publish/rollback via `transit.publish_revision` with step-up, cache revalidation of `transit:published` + saved-trip invalidation (`publish_followups` job); coverage 27 × 9 | `transit.revision.publish` (A12), `transit.revision.edit` (A13) |
| C9 Corrections review | A14 | `community.correction`, `correction_event`; Accept = change in draft, never publish; templated reasons | `correction.review` (no self-review) |
| C10 Moderation + appeals | A15, A16 | `jev_evidence`, `moderation_decision`, `appeal`, `user_restriction`; overrides need a note; appeals routed away from the original moderator | `community.moderate`, `community.appeal.resolve` |
| C11 Complaint review | A17 | `priv.v_complaint_review`, `complaint_event`, `evidence_access`, `issue_evidence_url`; no thumbnails in lists; break-glass for admins with reason + notification of other admins | `complaint.review`, `complaint.evidence.read` (complaint_reviewer only; step-up) |
| C12 Users, Jev, jobs, audit | A18 Users & roles, A19 Jev & providers, A20 Jobs, A21 Audit log | `core.grant_role()` / revoke (reason, no self-grant, session rotation), `ops.provider_health`, diagnostics with synthetic input (`ops.jev.diagnose` audited), `ops.job` retry/requeue, `core.audit_event` filters (read-only) | `roles.grant`; `ops.jev.diagnose`; admin for jobs; `audit.read` (others: own actions) |

Every C task: e2e on the desktop Playwright project with axe (light/dark), integration RLS matrix per role (guest/commuter/contributor/transport_reviewer/community_moderator/complaint_reviewer/admin), and an audit row asserted for each state change. AC-8 (review → evidence → publish → retire/relocate) is the exit check for C3+C8.

### Security checks specific to C
- Publish blocked on any validation error; optional two-person rule (`publish_requires_second_reviewer` flag).
- Admin nav and pages hidden and refused server-side for roles without the action; `/admin` responses `private, no-store`; never cached by the SW.
- Complaint area: list without previews, evidence loads only on open, 60 s signed links, access logged, 15-minute unlock window.
- Users & roles: search by full email only (no user enumeration), reason required, self-change disabled.
- Jev panel never shows keys or error bodies.

---

## Open product decisions that need the user

- **Q-B1 Sign-in methods.** The spec says email one-time link/OTP + Google; the SignIn artboard shows "Sign in with Apple" and "Use a passkey" instead of Google. Which providers should ship (each needs its OAuth client set up in Neon Auth by you)?
- **Q-B2 Account sync.** Should signing in sync saved trips and places to the server (artboard copy "Signing in only syncs your saved trips and places"), or should accounts exist only for contributions and reports while saved items stay on the device?
- **Q-B3 Jev go-live.** Is the OpenRouter key set in Vercel with a daily request budget you accept, and do you agree that `AUTO_PUBLISH_ENABLED` stays false (every post reviewed by a person) until thresholds are calibrated on a labelled sample?
- **Q-B4 Reviewers.** Who are the first transport reviewer, community moderator and complaint reviewer (three different people, per §7.7)? Without a complaint reviewer, driver reports should not launch.
- **Q-B5 Legal texts.** Privacy notice, terms, AI-processing disclosure and the complaint retention period (spec default 365 days after closure) need your/counsel's approval before Increment B ships; the PIA for driver complaints is a prerequisite for ever enabling `JEV_COMPLAINTS_ENABLED`.
- **Q-B6 Job cadence and plan.** Per-minute Vercel Cron needs a paid Vercel plan; otherwise a Neon scheduled trigger calls `/api/cron/jobs`. Which do you want?
- **Q-C1 Automatic face/plate boxing.** The Stops & curbs artboard says "Faces and plates are boxed automatically". That needs an image-detection provider (photos would leave our infrastructure). Approve a provider, or keep redaction fully manual (current spec default: human review only)?
- **Q-C2 Two-person publishing.** Turn on `publish_requires_second_reviewer` from the start (publisher must differ from the last editor), or allow a single reviewer to publish while the team is small?

## Decisions (Jev typed decisions, 2026-10-16, model typesafe/jev-1.13-20260917; user delegated these to Jev)

| Question | Decision | p |
|---|---|---|
| Q-B1 Sign-in methods | Email one-time code plus Google (passkey and Apple later) | 0.75 |
| Q-B2 Sync | Signed-in users can opt in to sync saved items; default stays on the device | 0.91 |
| Q-B3 Jev go-live | Triage community posts only, auto-publish off; never on driver complaints until the privacy impact assessment is done | 0.77 |
| Q-B4 Driver reports | Launch only after a named complaint reviewer exists; until then hand off to MyNaga. Owner confirmed 2026-10-22; gated by `DRIVER_REPORTS_ENABLED` (default false, N2) | 0.97 |
| Q-B6 Job scheduling | Vercel daily cron plus on-demand processing when an admin opens a queue (Jev abstained at 0.61; controller took the top choice) | 0.61 |
| Q-C1 Face/plate redaction | Manual redaction by reviewers with in-browser box tools; no external provider | 0.77 |
| Q-C2 Publishing | Single-reviewer publish while the team is small, with audit log and a configurable switch to two-person | 0.96 |
| Q-B5 Legal texts | Ship drafts marked "pending legal review"; driver complaints stay blocked until approved | 0.95 |
