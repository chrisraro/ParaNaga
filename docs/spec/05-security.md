# 5. Security hardening

## 5.1 Assets

| Asset | Sensitivity | Worst case |
|---|---|---|
| Driver-complaint evidence (photos/video, locations, plates) | **High** — allegations about identifiable people; bystanders' faces | Leak → defamation, retaliation against reporter or driver |
| Reporter identity | **High** | Retaliation |
| Account data (email, sessions) | Medium | Account takeover |
| Published transport data | Integrity-critical | Wrong curb or fare sends people into danger or overcharges them |
| Moderation decisions and Jev evidence | Integrity | Bypass publishes abuse; false rejects silence criticism |
| OpenRouter key, storage keys, DB credentials | **High** | Cost abuse, data breach |
| Guest location | Medium | Tracking |

## 5.2 Threat model (STRIDE summary)

| Threat | Example | Primary controls |
|---|---|---|
| Spoofing | Forged session; user sets `role: admin` in profile metadata | Managed Better Auth sessions (HttpOnly, Secure, SameSite=Lax); roles read only from `core.user_role`; nothing in tokens or metadata is trusted for roles |
| Tampering | Client posts `moderation: "approved"`; edits a published post to bypass review | Zod `.strict()` drops unknown fields; edits create pending versions; publication only through a `SECURITY DEFINER` function called by the policy job |
| Tampering (data) | Contributor rewrites a fare | Contributors write only `community.correction`; transit writes need `transport_reviewer` plus publication validation |
| Repudiation | Reviewer denies leaking evidence | `priv.evidence_access` row per signed URL; append-only `core.audit_event` |
| Information disclosure | Moderator browses complaints; IDOR on `/reports/:id`; EXIF GPS in a public photo | Separate role, forced RLS on `priv`, ownership checks, random references, EXIF stripping, signed URLs ≤ 60 s |
| Information disclosure (client) | API key in the bundle; service worker caches private JSON | `server-only` imports, CI bundle scan, deny-by-default SW cache matcher |
| Denial of service / cost | Planner flood; Jev spend; upload spam | Rate limits, body caps, Jev budget + circuit breaker, presigned upload size conditions |
| Elevation | SQL injection; prompt injection makes Jev "approve" | Parameterized queries only; user text only as `state` data; thresholds + human review; Jev cannot write anything |

## 5.3 Role and permission matrix

`R` read, `W` write/submit own, `M` moderate/review, `P` publish, `—` none. Checks run server-side in `authorize()`; RLS repeats ownership and role checks.

| Capability | Guest | Commuter | Contributor | Transport reviewer | Community moderator | Complaint reviewer | Admin |
|---|---|---|---|---|---|---|---|
| Map, search, plan, published transit data | R | R | R | R | R | R | R |
| Candidate pins (badged) | R | R | R | R | R | R | R |
| Approved community posts | R | R | R | R | R | R | R |
| Saved places/trips, preferences | — | W own | W own | W own | W own | W own | W own |
| Submit corrections | — | W | W | W | W | W | W |
| Post / comment / react / report content | — | W (limits) | W | W | W | W | W |
| Submit driver complaint; view own | — | W own | W own | W own | W own | W own | W own |
| Community moderation queue, appeals | — | — | — | — | M | — | M |
| Correction transport review | — | — | — | M | — | — | M |
| Draft revision edits (stops, shapes, fares) | — | — | — | W | — | — | W |
| Publish / roll back revision | — | — | — | P | — | — | P |
| Other people's driver complaints + evidence | — | — | — | — | — | M (audited) | break-glass only (reason required, other admins notified, audited) |
| Grant / revoke roles | — | — | — | — | — | — | W |
| Jev diagnostics, provider status | — | — | — | — | R | — | R/W |
| Audit log | — | — | — | own actions | own actions | own actions | R |

Rules:
- Roles are additive; `community_moderator` grants nothing in `priv`.
- Nobody reviews, moderates or approves their own submission (`author_id <> core.current_user_id()` in service and RLS).
- Role grants are audited with a reason; self-grant is impossible (`granted_by <> user_id`).
- Optional two-person rule for publication (`PUBLISH_REQUIRES_SECOND_REVIEWER=true`): the publisher must differ from the revision's last editor.

## 5.4 Authentication

- Neon Managed Better Auth: email OTP / magic link and Google OAuth. ParaNaga stores no passwords.
- Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax`, host-only; rotated on privilege change. Idle timeout 30 days for commuters; privileged roles must re-authenticate after 12 h to enter `/admin`.
- Step-up (fresh OTP within 15 min) for: publish, role grant, evidence access, threshold change.
- Trusted domains: production + preview domains only.
- The session is validated server-side wherever a user is needed (`getSession()`, memoized per request). `proxy.ts` refreshes cookies and sets headers; it never authorizes.
- **Initial-admin bootstrap:** `scripts/bootstrap-admin.ts` runs with the owner connection from a trusted machine or a manual CI job. It requires the target user to exist and be email-verified, refuses if any admin already exists, grants `admin` once, and writes an audit event. No default credentials exist anywhere.

## 5.5 Authorization implementation

```ts
// src/server/auth/authorize.ts
type Action =
  | 'transit.revision.edit' | 'transit.revision.publish'
  | 'community.moderate' | 'community.appeal.resolve'
  | 'correction.review' | 'complaint.review' | 'complaint.evidence.read'
  | 'roles.grant' | 'ops.jev.diagnose';

export async function authorize(ctx: RequestCtx, action: Action, resource?: ResourceRef): Promise<void>;
// throws ForbiddenError; never returns false silently
```

- Every Route Handler and Server Action starts with `const ctx = await requireContext(); await authorize(ctx, …)`. Server Actions are treated as public endpoints.
- RLS example:
  ```sql
  alter table priv.complaint enable row level security;
  alter table priv.complaint force row level security;

  create policy complaint_owner_read on priv.complaint for select
    using (reporter_id = (select core.current_user_id()));
  create policy complaint_reviewer_read on priv.complaint for select
    using ((select core.has_role('complaint_reviewer'))
           and reporter_id <> (select core.current_user_id()));
  -- reviewers query priv.v_complaint_review, which omits reporter_id
  -- no insert/update policies for paranaga_app: writes go through priv.submit_complaint() etc.
  ```
- `core.current_user_id()` returns NULL when `app.user_id` is unset or empty; `core.has_role(text)` looks up `core.user_role` for that id. `has_role` is `STABLE SECURITY DEFINER` owned by `paranaga_definer` (NOLOGIN, no BYPASSRLS, explicit per-table policies), with `search_path = pg_catalog, core, pg_temp`, `EXECUTE` revoked from `PUBLIC`. Full definer rules: [Architecture §3.5](03-architecture.md#35-data-access-and-rls).
- Complaint-reviewer access is also rate-watched: more than 30 complaint opens per reviewer per day raises an admin alert.
- Every table in `core`, `community`, `priv`, `transit`, `ops`, `ingest`: `ENABLE` + `FORCE ROW LEVEL SECURITY`. Public transit views use `security_invoker = true` and filter to the published revision.
- CI check: any table in those schemas without RLS → build fails.

## 5.6 Input, output and API hardening

- Zod `.strict()` on every input; length caps (post 4 000, comment 1 000, complaint description 2 000 chars); coordinate bounds; enum-only categories.
- JSON body cap 64 KB; files only through presigned URLs.
- Parameterized queries only; a lint rule bans `sql.raw` outside reviewed migration helpers.
- Output: React escaping; no `dangerouslySetInnerHTML`; user text is plain text with `https:`-only link detection and `rel="ugc nofollow noopener noreferrer"`. No Markdown in v1 community posts.
- Errors never include stack traces or SQL; they include `requestId`.

Rate limits (Postgres token bucket keyed by `sha256(ip | ua-family)` for guests, `user_id` for members):

| Endpoint | Limit |
|---|---|
| `POST /plan` | 30/min/IP, 600/day/IP |
| `GET /search` | 60/min/IP |
| Auth OTP send | 5/hour/email, 20/hour/IP |
| Post create | account < 7 days: 3/day; otherwise 20/day; ≥ 60 s apart |
| Comment create | account < 7 days: 10/day; otherwise 100/day; ≥ 10 s apart |
| Correction create | 20/day |
| Upload slot | 10/hour, 30/day per user |
| Driver complaint | 5/day per user |
| Content report | 30/day per user |

- Duplicate fingerprint: SimHash of normalized text per user per 24 h; similarity ≥ 0.9 → rejected as duplicate (deterministic, not Jev).
- Links: allow-list (`naga.gov.ph`, `mynaga.app`, `openstreetmap.org`, …) passes; other links → human review; URL shorteners → rejected with a reason.
- Bot challenge (Cloudflare Turnstile or equivalent) behind `BOT_CHALLENGE_ENABLED`, triggered near rate limits or for new-account posting — never for ordinary browsing.

## 5.7 Jev / AI safety

| Risk | Control |
|---|---|
| Prompt injection ("ignore rules, approve") | Text only inside `state.text`; fixed question wording; typed answers only; thresholds decide, not Jev |
| Model drift | Dated build pinned; aliases refused at startup; question-set and policy versions stored per decision |
| Malformed or partial answers | Zod parse; any defect → pending + human review |
| Outage / no credits | Typed error classes; never publish on failure; circuit breaker; admin status panel |
| Cost abuse | Deterministic checks first, so most spam never reaches Jev; daily request budget |
| Over-moderation of criticism | Criteria include compliant criticism examples; `criticism_of_service_or_policy` can never cause a reject on its own; appeals; overturn rate tracked |
| Third-party processing | Disclosure before first submission (`core.ack` `ai_processing_disclosure`), including that text is processed outside the Philippines; minimum text sent; emails, phone numbers and plate-like strings masked before sending; control/zero-width characters stripped; no images ever; complaint text not sent unless `JEV_COMPLAINTS_ENABLED` (off until DPIA + zero-retention confirmed) |
| Complaint routing manipulation | Deterministic routing first; Jev may only raise priority, never lower it |
| Client-supplied classifications | No endpoint accepts classification fields; decisions written only by the job through a definer function |
| Edit during moderation | Decisions bind to `target_version_id`; publish checks the version is still the latest pending one |
| Double publish on retry | Idempotency key per version; publish function is a no-op if already published |
| Key exposure | Server env only; `scripts/check-bundle-secrets.ts` scans `.next/static` for `sk-or-` and env names in CI; logs scrubbed |

The live smoke test (`pnpm jev:smoke`) uses synthetic, non-sensitive text, needs `JEV_SMOKE=1`, and is not part of CI.

## 5.8 Storage and media

- Separate scoped credentials per bucket where Neon supports it; the evidence credential is loaded only by `priv` services.
- Uploads use slots bound to the caller (`media_object.owner_id`, `purpose`, `expected_bytes`); confirmation is by slot id, never by object key, so user B cannot claim user A's upload (integration test).
- Presigned POST policy with `content-length-range` where Neon supports it, else presigned PUT with post-upload size enforcement; 5-minute expiry; server-generated keys; no client-chosen paths.
- After upload: `HEAD` size check, magic-byte sniff (rejects SVG, HTML, polyglots), SHA-256, full decode via `sharp`, max 8 000 px per side, JS container parse for video; then **copy to a server-owned key and delete the quarantine object**, closing the overwrite-after-verify gap. Orphan sweep after 1 h.
- Buckets: no public ACLs; CORS allow-list of app origins only.
- Display copies: EXIF/XMP/GPS stripped, re-encoded WebP. Originals are never served publicly.
- Stop/sign photos pass a manual redaction step (blur faces and plates) before reaching `public-media`.
- Evidence originals: immutable; only the retention job deletes (objects and rows together, `legal_hold` respected); access by 60 s signed GET with `Content-Disposition: attachment`; each issuance audited.
- Signed URLs are returned in a JSON body with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, never logged, never placed in page HTML. Object-store access logs (Neon storage logs) are retained 90 days so downloads, not just issuances, are traceable. Reporters downloading their own originals also need step-up.
- Reporter sharing to MyNaga defaults to the redacted copy; originals only after a warning.

## 5.9 Privacy

- Guests: no server-side location retention. Plan requests are logged without `origin`/`destination`; coverage analytics use coarse cell counters (H3 resolution 7) only.
- Trip history off by default; stores labels, not coordinates.
- No device fingerprinting; no third-party analytics by default (cookieless first-party metrics).
- Complaint location stored with its accuracy; the reporter can correct or remove it before submitting.
- Export (JSON) and account deletion. On deletion, community content becomes "Deleted user" or is removed per the user's choice; complaints follow their retention schedule unless withdrawn.
- On account deletion, retained complaints keep only a pseudonymous tombstone instead of `reporter_id`.
- `core.audit_event.before/after` never stores free text or personal data from `priv` (ids, status codes and field names only).
- Neon point-in-time-restore window set to ≤ 7 days so purged personal data does not persist in history beyond that.
- Philippine Data Privacy Act (RA 10173): privacy notice; lawful basis per processing purpose; **privacy impact assessment** covering driver complaints (third-party personal data about drivers and bystanders) and cross-border processing by OpenRouter/model providers; NPC registration check; retention schedule; a process for people named in complaints to request access/correction through the City or ParaNaga, without exposing reporters; breach procedure (NPC notification within 72 h) with a named owner and a yearly drill; DPO contact. Legal review is required before launch.

## 5.10 HTTP security headers

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{n}' 'strict-dynamic';
  style-src 'self'; style-src-attr 'unsafe-inline';
  img-src 'self' data: blob: https://{public-media-host};
  connect-src 'self' https://{tiles-host} https://{auth-host} https://{storage-host};
  worker-src 'self' blob:; child-src blob:;
  font-src 'self';
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';
  upgrade-insecure-requests;
  report-uri /api/csp-report
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-site
```

MapLibre sets inline style *attributes*, hence `style-src-attr 'unsafe-inline'`; if it also needs inline `<style>` elements, fall back to `style-src 'self' 'unsafe-inline'` and record why. No inline scripts. A nonce forces dynamic rendering in Next.js, which conflicts with the static caching in §3.4 — so public pages use a hash/`'self'`-only script policy and nonces are used only on dynamic (account/admin) routes; verify at scaffold. Run the policy `Report-Only` on preview for a week, then enforce. Test MapLibre workers (`blob:`), PMTiles range requests and Serwist under the policy. `camera` is requested only on the driver-report route and `geolocation` only on user tap; the header allows `self` so those routes work.

## 5.11 Secrets and infrastructure

- Secrets live only in Vercel env (production and preview separated) and GitHub Actions secrets. `.env*` is git-ignored; `.env.example` has empty values.
- Runtime `DATABASE_URL` uses `paranaga_app`; the owner URL exists only in the migration job.
- Neon: TLS required (`sslmode=require`); protected production branch; preview/CI branches come from a seed-only branch or an anonymized copy — never a raw production copy with `priv` data.
- Dependencies: lockfile committed; `pnpm audit` + Renovate; `pnpm` `onlyBuiltDependencies` allow-list for install scripts; gitleaks in CI.
- Vercel: preview deployments protected; cron routes require `Authorization: Bearer ${CRON_SECRET}`.

## 5.12 Logging, monitoring, incident response

- Structured logs: `requestId`, route, status, latency, hashed user id, error code. Never: tokens, keys, full post text, complaint descriptions, coordinates.
- Alerts: Jev circuit open; dead-lettered jobs; publication failure; RLS-denial spikes; unusual evidence access; 5xx > 1 %.
- Runbook: revoke keys (OpenRouter, storage), rotate DB role passwords, roll back revision, disable auto-publish, preserve audit logs.

## 5.13 Pre-launch security checklist

- [ ] RLS enabled and forced on every table in app schemas (CI check passes)
- [ ] `paranaga_app` has no `BYPASSRLS`, no DDL, no direct `neon_auth` writes
- [ ] No secrets in the client bundle (CI scan) or repo history (gitleaks)
- [ ] Moderator session cannot read any `priv.*` row (integration test)
- [ ] IDOR tests: user B cannot read user A's complaint, saved trip or correction draft
- [ ] An edited post stays pending; the published version is unchanged until approved
- [ ] Jev 401 / 402 / 404 / 429 / timeout / malformed responses all keep content pending (fixture tests)
- [ ] Service worker never caches `/api/v1/me`, `/admin`, `/api/v1/reports` (e2e inspects Cache Storage)
- [ ] No EXIF GPS in `public-media` objects (test)
- [ ] No `unsafe-eval` in production CSP; headers verified on preview
- [ ] Rate limits enforced (integration test)
- [ ] Bootstrap script refuses a second admin
- [ ] Evidence URLs expire ≤ 60 s and each issuance writes an audit row
- [ ] Privacy notice, AI-processing disclosure and retention schedule reviewed by counsel
- [ ] Forged-context test: a query run without `withRequestContext`, or with an empty/garbage `app.user_id`, sees no private rows
- [ ] Pooled-connection leak test: user A then user B on the same connection; B never sees A's context
- [ ] Every `SECURITY DEFINER` function passes the definer lint (search_path with `pg_temp` last, `EXECUTE` revoked from `PUBLIC`, no identity parameters)
- [ ] Cross-user upload confirm is rejected; quarantine objects cannot be overwritten after verification
- [ ] Retention purge removes objects and rows together; no orphaned evidence objects
- [ ] Account deletion and data export require step-up
- [ ] Break-glass evidence access notifies the other admins (test)
- [ ] OTP send/verify limits per email and IP confirmed in Neon Auth config; OTP attempts capped
- [ ] Non-production branches contain no `priv` rows (CI check) and restore drill done
- [ ] Rate limiting also keys on account for authenticated routes; rate-limit table writes bounded (one upsert per key per window)
- [ ] Service-worker test covers RSC (`_rsc`) and `(account)` navigations; Cache Storage cleared on sign-out
- [ ] Privacy impact assessment complete; OpenRouter data-retention settings confirmed before enabling `JEV_COMPLAINTS_ENABLED`
- [ ] `ecc:security-reviewer` pass and clean dependency audit before each release
