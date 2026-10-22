# Increment B: Accounts, Community, and Reporting — Implementation Plan

Status (2026-10-22): finished except B4 (WebP re-encode of uploads).

Date: 2026-10-18  
Base Branch: `master`  
Specs: `docs/spec/02-features.md`, `docs/spec/03-architecture.md`, `docs/spec/04-data-model.md`, `docs/spec/05-security.md`, `docs/spec/06-screens.md`, `docs/plans/2026-10-16-accounts-community-admin-outline.md`

---

## 1. Executive Summary & Architecture Foundation

Increment B establishes the authenticated user surface, community participation, and safety reporting while preserving ParaNaga's strict core promises:
1. **Zero-tracking & optional account posture**: Everything in ParaNaga continues to work seamlessly as a guest. An account is purely optional for community posts, corrections, and syncing.
2. **Honesty & copy boundaries**: Estimates remain marked "Est."; waiting remains "+ waiting (unknown)"; no "ETA", "live", "arriving", or "e-jeepney" wording anywhere; tricycle/padyak times never in minutes.
3. **Double-walled security**: Every Route Handler & Server Action enforces `authorize(action, resource)` first, followed by strict PostgreSQL Row-Level Security (RLS) via `withRequestContext({ userId, requestId })`.
4. **Jev AI guardrails**: AI is used strictly for evidence scoring (`typesafe-jev`), never as an autonomous authority. When Jev fails or is unavailable, content safely remains pending human review (`AUTO_PUBLISH_ENABLED=false`). Complaint text is never forwarded to Jev without legal clearance.
5. **Private driver complaints**: Completely separated from public community data (`priv.*` schema); zero access granted to community moderators; evidence stored in private storage with short-lived (60s) signed URLs.

---

## 2. Task Sequencing & Delivery Phases

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: IDENTITY & CORE ACCOUNT (Tasks B1 - B2)                           │
│ B1: Sign-in (S21, Neon Auth / Managed Better Auth, Email OTP + Google)      │
│ B2: Optional Saved Items Sync (/api/v1/me/saved-*, device stays offline src)│
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼───────────────────────────────────────┐
│ PHASE 2: PLATFORM INFRASTRUCTURE (Tasks B3 - B5)                            │
│ B3: Token-Bucket Rate Limiter & Async Job Worker Loop                       │
│ B4: Media Upload Pipeline (S3/Neon Object Storage: Quarantine -> Public/Priv)│
│ B5: Jev Moderation Pipeline Adapter & Fail-Pending Policy Gate              │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼───────────────────────────────────────┐
│ PHASE 3: COMMUNITY & REPORTING SURFACES (Tasks B6 - B9)                     │
│ B6: Report a Correction (S16 Wizard: Stops, Routes, Fares, Trips)           │
│ B7: Community Hub (S17 Feed, Threaded Comments, Guidelines, Bookmarks)      │
│ B8: Report a Driver (S18 Private Flow, In-App Camera, priv.complaint)       │
│ B9: My Reports (S19) & MyNaga Handoff Integration (S20)                     │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼───────────────────────────────────────┐
│ PHASE 4: VERIFICATION & HARDENING (Task B10)                                │
│ B10: Multi-Role IDOR/RLS Suite, Cache Audit, WCAG 2.2 AA Pass & Final Review │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Task Specifications

### Task B1: Sign-in & Profile Management (S21, F-C1)
- **Goal**: Implement optional commuter sign-in via Neon Auth (Managed Better Auth) with Email OTP and Google OAuth.
- **Routes & UI**:
  - Route `/app/sign-in` based on artboard `SignIn`.
  - Prominent copy: *"An account is optional. Everything in ParaNaga works as a guest, and your saved trips stay on this phone."*
  - Update `MoreScreen` (`src/ui/settings/more-screen.tsx`):
    - Replace static "No account needed" placeholder with dynamic account card:
      - Signed out: "Sign in" action with explanation.
      - Signed in: Display name, role badge (`commuter`, `contributor`, etc.), "Sign out" (clears account stores), "Export my data" (JSON), "Delete account" (step-up confirmed).
- **Backend & Security**:
  - `getCurrentUser()` automatically calls `core.ensure_commuter(name)` on first authenticated request.
  - Proxy matcher in `src/proxy.ts` keeps `/account/**` and `/admin/**` protected.
  - Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax`.

### Task B2: Optional Server Sync for Saved Places & Trips (F-C1, §4.2)
- **Goal**: Allow signed-in users to optionally sync saved places and saved trips to their account.
- **Database & RLS**:
  - Migration `0013_core_saved_sync.sql` (or next sequence):
    - `core.saved_place` (`user_id`, `place_key`, `custom_label`, `created_at`, `updated_at`).
    - `core.saved_trip` (`user_id`, `trip_id`, `legs jsonb`, `revision_id`, `invalidated_at`).
    - Policy: `user_id = core.current_user_id()`.
- **API & Client**:
  - Endpoints: `GET /api/v1/me/saved-places`, `POST /api/v1/me/saved-places`, `GET /api/v1/me/saved-trips`, `POST /api/v1/me/saved-trips`.
  - Cache headers: `private, no-cache, no-store`.
  - First sign-in dialog: "Sync saved trips on this phone to your account? [Keep on phone only] [Sync now]".

### Task B3: Rate Limiting & Background Job Worker (Ops §3.10, §5.6)
- **Goal**: Protect API endpoints from abuse and provide a reliable async job worker.
- **Database**:
  - Migration `0014_ops_ratelimit_jobs.sql`:
    - `ops.take_token(key_hash, window_seconds, limit)` atomic token bucket function.
    - `ops.job` table (`id`, `kind`, `payload`, `status`, `run_at`, `leased_until`, `attempts`).
- **Implementation**:
  - `src/server/ratelimit/token-bucket.ts`: Apply rate limits to `/api/v1/plan` (30/min, 600/day per guest IP / user) and writes.
  - `src/server/jobs/worker.ts`: Atomic `FOR UPDATE SKIP LOCKED` claim loop.
  - Cron route: `/api/cron/jobs` guarded by `CRON_SECRET`.

### Task B4: Media Upload Pipeline (§3.9, Neon Object Storage / S3)
- **Goal**: Safe, zero-leak upload flow for community images and driver complaint evidence.
- **Pipeline Architecture**:
  - Buckets: `quarantine`, `public-media`, `evidence-private`.
  - Client requests presigned upload slot (`POST /api/v1/media/slots`).
  - Client uploads to `quarantine` -> Calls confirmation endpoint (`POST /api/v1/media/confirm`).
  - Server verifies magic bytes, decodes via `sharp`, checks dimensions (≤ 8000 px), strips EXIF/GPS, generates WebP derivatives (≤ 1600 px).
  - Promotes sanitized media to `public-media` (or `evidence-private` for complaints) and deletes quarantine item.

### Task B5: Jev Moderation Pipeline Adapter & Fail-Pending Gate (F-D3, §3.8)
- **Goal**: Connect Jev AI for text classification with hard circuit-breaking and fail-pending guarantees.
- **Implementation**:
  - Adapter `src/server/adapters/jev/client.ts` interacting with `JEV_DECISIONS_URL`.
  - Enforce pinned dated model (`JEV_MODEL_ID`, e.g., `typesafe/jev-1.13-20260917`).
  - Pure policy function `src/domain/moderation/policy.ts`:
    - If `AUTO_PUBLISH_ENABLED=false`, all submissions not flagged high-certainty-reject are held for human review.
    - Jev failure / timeout / 5xx automatically keeps content pending without blocking user submission.

### Task B6: Report a Correction (S16, F-D1)
- **Goal**: 3-step reporting wizard from stops, routes, fares, and trips.
- **Workflow**:
  1. *What's wrong*: Category select (Wrong curb side, Stop moved/removed, Route doesn't stop here, Fare mismatch, etc.).
  2. *Tell us what you saw*: Prefilled entity references, optional GPS coordinate with accuracy display, optional photo attachments.
  3. *Review and send*: Summary view with AI disclosure before first submission (`core.ack`).
- **Data Lifecycle**:
  - `community.correction` status flow: `draft` -> `submitted` -> `under_review` -> `accepted` / `rejected` -> `incorporated`.
  - Rule: Community submissions never alter published transit data directly.

### Task B7: Community Hub (S17, F-D2)
- **Goal**: Public commuter discussions, tips, and official announcements.
- **Features**:
  - Navigation: Add "Community" tab to main navigation shell.
  - Community Feed: Filter by topic (Commute tips, First-time questions, Route/stop feedback), search, and tags.
  - Threads: Posts with up to 2 levels of nested comments.
  - Interaction: Helpful reactions, bookmarks, author edit history (edits spawn pending version while published remains live).
  - Safety: Community guidelines acknowledgment before first post, user blocking, and content reporting.

### Task B8: Report a Driver (Private Flow, S18, F-D4)
- **Goal**: Safe, private reporting flow for commuter safety incidents.
- **UI Steps**:
  1. *Explainer*: Privacy & safety notice, emergency 911 warning, clarification that reports are not auto-sent to City Hall.
  2. *In-app Capture*: `getUserMedia` camera capture (rear camera preferred) with photo/video preview; fallbacks to file upload or text-only.
  3. *Details Form*: Category (Overcharging, Reckless driving, Discount refused, Harassment, Improper loading/unloading, Other), incident time, location, operator, vehicle plate/body number.
  4. *Acknowledgment & Submission*: Review screen -> Submit privately -> Receipt with reference `PN-XXXX-XX`.
- **Database & Access Control**:
  - Stored strictly in `priv.complaint`.
  - Strict RLS: Commuters see only their own complaints; community moderators have zero read grants; complaint reviewers require step-up.

### Task B9: My Reports & MyNaga Handoff (S19, S20, F-D5)
- **Goal**: Status tracking for submitted reports and seamless manual handoff to the official MyNaga app.
- **Features**:
  - `/app/reports`: Status timeline of submitted corrections and driver complaints.
  - MyNaga Handoff (`/app/mynaga`):
    - Copy structured summary for pasting.
    - Download redacted evidence (unredacted requires explicit bystander warning).
    - Verified external links to MyNaga store pages and city portal.
    - Self-reported status toggle: "I submitted it in MyNaga" with optional external reference number.

### Task B10: Verification, Multi-Role RLS & Hardening
- **Goal**: Comprehensive security, accessibility, and integrity audit.
- **Checks**:
  - IDOR & RLS Matrix: Test guest vs commuter vs contributor vs moderator vs complaint reviewer access across all tables.
  - Secret & Cache Scan: Verify SW never caches authenticated endpoints or private media.
  - Accessibility: Full `@axe-core/playwright` pass across all new screens in light and dark modes.
  - Copy Honesty Audit: Strict enforcement against ETA / live / arriving wording.

---

## 4. Worktree & Delivery Plan

Each task will be executed in its own isolated worktree (`.worktrees/b1-auth`, `.worktrees/b2-sync`, etc.), validated through static checks and unit/integration tests, and submitted as an atomic pull request to `master`.
