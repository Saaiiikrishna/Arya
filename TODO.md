# Aryavartham Platform — Implementation Backlog

> Last updated: 2026-05-16 (All P0–P4 + WhatsApp complete; both builds clean; remaining: Stage 5 GTM + Mux/CDN for documentary)
> Tracking agent: Claude (claude-sonnet-4-6)
> When a task is completed, mark it `[x]` and add the commit hash in parentheses.
> CLAUDE.md update policy: mark the task done here AND note any schema/infra changes in root CLAUDE.md.

---

## Completed Work

- [x] Auth & OTP login, Google OAuth, JWT refresh token flow
- [x] Batch lifecycle management (FILLING → PRODUCTION, 6 stages)
- [x] Application form, question bank, eligibility screening
- [x] Smart team formation algorithm (idea-based + builder pool)
- [x] Team size enforcement, dept roles (5 required), team locking
- [x] Team change requests (SEPARATION, JOIN_EXISTING, CREATE_NEW, SWAP, RESOURCE, COMPLAINT)
- [x] Leader election (nomination → voting → results)
- [x] Interview scheduling (admin slots, applicant booking, decisions) — `efd9541`
- [x] Async video submission (3 URLs, admin scoring) — `efd9541`
- [x] Department board UI + Hub wiring — `efd9541`
- [x] Sprint + milestone tracker (backend)
- [x] Project management model
- [x] Document management (S3 uploads, consent, verification)
- [x] Training library (modules, bulk assign, completion)
- [x] Real-time team chat (Socket.io, JWT-authed rooms)
- [x] Investor portal (registration, approval, showcase, meeting requests)
- [x] Equity system (51-49 split, 1000-day timer, handover automation)
- [x] Payments (Razorpay pledge + webhook)
- [x] Referral & affiliate tracking
- [x] Analytics (visitor tracking, page stats, batch analytics)
- [x] Email template engine (slug-based, variable interpolation)
- [x] Announcements (batch-scoped with deadlines)
- [x] Security hardening — identity pinning, token storage, RBAC — `17edb1a`, `3d9b73a`, `fdc0655`, `1788c00`

### Storefront / Articles / Marketing program (PR #9, branch `claude/storefront-articles-marketing`)
- [x] New premium marketing landing at `/`; original landing moved to `/startup`; nav + DESIGN.md §7 "Public Marketing" layer (glossy/rounded `mkt-*`, scoped)
- [x] Removed Sanskrit shloka + image from the (now `/startup`) landing; rounded hero pill
- [x] Full-enterprise commerce architecture — `docs/COMMERCE_ARCHITECTURE.md` (architect→critic)
- [x] Commerce schema + 10 migrations + shipment-number migration
- [x] Commerce backend: catalog, inventory (multi-warehouse), tax (GST), store-media, coupons, cart, diy, purchasing, orders/checkout (Razorpay), invoicing (GST PDF), shipping (courier), returns (RMA), real-time gateways, jobs, analytics
- [x] Articles backend: submission → moderation → publish, media (15img/3vid), view metrics, related, author-vs-admin visibility
- [x] Frontend: storeApi/storeAuth/sockets + component kit; public storefront (catalog, product detail w/ dynamic tabs, DIY build, cart, Razorpay checkout, account, order tracking); public articles (list/detail/submit); admin `/admin/store/*` dashboards

#### Storefront follow-ups
- [x] Socket.io **Redis adapter** for cross-replica real-time fan-out (store + chat gateways) — `6256c31`
- [x] Integration test suite on real Postgres (oversell/coupon/tax/invoice paths; 4 suites/23 tests) — `8f27a5d`
- [x] `ArticleStatus` DRAFT + ARCHIVED states (enum migration `20260613000000`) + save-draft/archive/restore UI — `6256c31`
- [x] Dedicated admin product-LIST endpoint (`GET /admin/store/products`, all statuses) — `6256c31`
- [x] Backend list endpoints presign thumbnail read URLs (catalog + article covers) — `6256c31`
- [ ] (ops, not code) Populate default warehouse state/GSTIN via `/admin/store/settings` before the first production invoice
- [ ] (optional) Deeper checkout/refund e2e on real PG+Redis with a Razorpay test-mode client (current int-suite mocks external SDKs)

---

## P0 — Blockers (Platform Cannot Run Without These)

### Mentor System
> Team change requests must go through mentor approval per spec. Currently admin-only — spec violation.

- [x] Add `Mentor` model to Prisma schema (user relation, assigned teams list, expertise) — schema.prisma updated
- [x] Migration for mentor table — schema updated; run `npm run db:migrate` to generate migration file
- [x] Mentor assignment endpoint — admin assigns mentor to team after auto-grouping — `MentorController POST /api/mentor/assign`
- [x] Wire SEPARATION/JOIN_EXISTING/CREATE_NEW requests through mentor approval first, then admin — `mentorStatus: PENDING` on create; admin blocked until `APPROVED`
- [x] Mentor portal dashboard (assigned teams, pending requests queue) — `GET /api/mentor/teams`, `GET /api/mentor/requests`
- [x] JWT claim + guard for mentor-only routes — `MentorGuard` in `mentor.guard.ts`; `validateUser` + `refreshToken` handle MENTOR role
- [x] Admin page `/admin/mentors` — list, assign, manage mentors — `frontend/src/app/admin/mentors/page.tsx`
- [x] Hub page `/hub/mentor` — founders see their mentor, expertise, guidance — `frontend/src/app/hub/mentor/page.tsx`; data from extended `getMyHub`

### Automated Email Triggers
> These are commitments to applicants; current email engine exists but zero event triggers are wired.

- [x] Interview decision → email (SELECTED: welcome email, REJECTED: thank-you email) — wired in `interview.service.ts recordDecision`
- [x] Team assignment → email to each cohort member with team details — fire-and-forget in `team.service.ts formTeams`
- [x] Deadline reminders: D-7, D-3, D-1 scheduled jobs for batch instruction deadlines — `SchedulerService.sendDeadlineReminders()` cron `0 2 * * *`
- [x] Team lock confirmation → email to all team members — wired in `team.service.ts lockTeam`
- [x] Co-founder assignment → email to founding team — wired in `cofounder.service.ts assignToTeam`
- [x] MVP milestone completed → email notification — `completeMilestone` in sprint.service.ts; fires when all sprint milestones are marked done; `PATCH /sprints/milestones/:id/complete` endpoint + hub sprint UI complete button
- [x] Pitch invitation → email to team lead + co-founder — wired in `investor.service.ts createPitchEvent`; sends `pitch-invitation` template to leader + active co-founder
- [x] No-show auto-detection: bookings with no decision after slot endTime → mark NO_SHOW + email — `SchedulerService.detectNoShows()` cron `EVERY_HOUR`
- [x] Mentor assigned → email to each team member with mentor details and contact — wired in `mentor.service.ts assignToTeam`

---

## P1 — Core Operations (Required for Stage 2+)

### Co-Founder System
> One platform staff per finalized team embedded as actual co-founder — currently no model or logic.

- [x] Add `CoFounder` model (staff user, team, assigned date, report history) — schema.prisma updated with `CoFounder`, `CoFounderAssignment`, `WeeklyReport`, `ResourceRequest` models
- [x] Migration for co-founder table — schema updated; run `npm run db:migrate`
- [x] Admin endpoint to assign co-founder to a locked team — `CoFounderController POST /api/cofounder/assign` (requires `isLocked === true`)
- [x] Co-founder portal — team sprint overview, blocker list, resource request form, weekly report submission — `GET /api/cofounder/teams`, `POST /api/cofounder/teams/:id/report`, `POST /api/cofounder/teams/:id/resource-request`
- [x] `WeeklyReport` model + submission endpoint (co-founder → platform, weekly cadence) — `WeeklyReport` model + `submitWeeklyReport` in cofounder.service.ts
- [x] Admin inbox for weekly reports — `GET /api/cofounder/admin/reports`; "Weekly Reports" tab built in `/admin/cofounders`
- [x] `ResourceRequest` model — co-founder requests infra/tools/space/experts; admin fulfills; status tracked — `ResourceRequest` model with `ResourceRequestStatus` enum
- [x] Email trigger: co-founder assigned → notify founding team — wired in `cofounder.service.ts assignToTeam`

### Hub — Sprint & Project Pages (Frontend Only — Data Exists)
> Sprint and project data is in the DB but founders have no UI to see or interact with it.

- [x] `/hub/sprint` — current sprint, milestone checklist, active blockers, check-in history — `frontend/src/app/hub/sprint/page.tsx`
- [x] `/hub/project` — project details editor (MVP description, tech stack, demo URL, status) — `frontend/src/app/hub/project/page.tsx` (leaders can edit; status badge displayed)

### Blocker Log & Weekly Check-in
- [x] `BlockerLog` model (team, week, description, severity HIGH/MED/LOW, resolution status) — `BlockerLog` model with `BlockerSeverity` enum in schema.prisma
- [x] `WeeklyCheckIn` model (team, week, progress summary, co-founder verified flag) — `WeeklyCheckIn` model with `coFounderVerified` flag in schema.prisma
- [x] Endpoints: submit check-in, log blocker, resolve blocker, co-founder verify check-in — all in `sprint.controller.ts` + `sprint.service.ts`
- [x] Hub sprint page shows active blockers and check-in status — displayed in `/hub/sprint` with severity colour coding and resolve button
- [x] Admin/co-founder view: all teams' check-in status for current week — `GET /admin/sprints/checkins/status?batchId=&week=`; "Check-ins Overview" tab in `/admin/sprints`

---

## P2 — Stage 4 Completion

### Documentary / Cinematic Pipeline
> The investor reel (reality-show style 90-day documentation) is a first-class feature per spec.

- [x] `DocumentaryClip` model (team, week number, video URL, thumbnail, title, published flag) — schema.prisma
- [x] Upload endpoint (admin / co-founder submits weekly clips via S3 presigned URL) — `POST /admin/documentary/teams/:teamId/upload-url` → confirm
- [x] Admin review + publish toggle per clip — `PATCH /admin/documentary/clips/:clipId/publish`
- [ ] Mux or Cloudflare Stream integration (replace raw S3 URLs with streaming player) — currently using S3 presigned URLs; upgrade when CDN is set up
- [x] Investor portal: documentary player page (clips in sequence, before pitch deck) — `Watch Journey ▶` button on showcase cards; `GET /investors/documentary/:teamId`
- [x] Admin page `/admin/documentary` — batch/team selector, clip grid, upload flow, publish/unpublish, delete

### Investor Pitch — Completion
- [x] Pitch event scheduling (admin sets pitch date/time per team) — `POST /admin/pitch/events`; `/admin/pitch` page
- [x] Investor interest tracking (shortlisted / passed per investor per startup) — `InvestorInterest` model + `POST /admin/pitch/events/:id/interest`
- [x] Post-pitch funding decision model (FUNDED / PASSED, amount, terms) — `FundingDecision` model + `POST /admin/pitch/events/:id/funding`
- [x] Admin page `/admin/pitch` — pitch calendar, investor interest + funding decision management — `frontend/src/app/admin/pitch/page.tsx`

---

## P3 — Autonomy & Self-Running Platform

### Automated Timeline Enforcement
- [x] Scheduled job: CREATE_NEW requests auto-rejected when batch moves past TEAM_FORMATION stage + email — `SchedulerService.enforceCreateNewDeadline()` cron `0 3 * * *`
- [x] Scheduled job: batch instruction deadline passes → mark overdue, send D-7/D-3/D-1 reminder email — `SchedulerService.sendDeadlineReminders()` cron `0 2 * * *`
- [x] Scheduled job: weekly check-in due every 7 days from co-founder assignment → remind co-founder if not submitted — `SchedulerService.remindWeeklyCheckIns()` cron `0 3 30 * * *`
- [x] Scheduled job: no-show detection (booking past endTime with no decision → mark NO_SHOW) — `SchedulerService.detectNoShows()` cron `EVERY_HOUR`

### WhatsApp Integration
> Decision: WABA (Meta Business Suite). Full implementation complete.

- [x] Webhook controller (`GET /api/whatsapp/webhook` verify, `POST /api/whatsapp/webhook` receive)
- [x] Upgraded service to Graph API v21.0 — template sends, interactive buttons, broadcast
- [x] 16 approved-template stubs registered: AUTHENTICATION (otp_verification), UTILITY (team assignment, lock, mentor, co-founder, MVP, pitch, deadline reminders, check-in reminder), MARKETING (platform_announcement, batch_opening, referral_milestone)
- [x] Broadcast endpoint: `POST /admin/whatsapp/broadcast` with optional batchId/teamId filter + 100ms rate limiting
- [x] One-off send: `POST /admin/whatsapp/send` for admin one-off sends
- [x] Send log: `GET /admin/whatsapp/send-log` paginated from notification table
- [x] Wired into: team assignment, team lock, mentor assigned, co-founder assigned, MVP milestone complete, pitch invitation
- [x] Admin UI `/admin/whatsapp` — broadcast composer, send-one form, template registry with setup checklist, send log
- [x] Opt-in gate: `whatsappPhone` + `whatsappVerified = true` on Applicant (already in schema) required for all UTILITY sends
- [x] env vars: `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_VERIFY_TOKEN` added to `.env.example`

### Role-Based Access Hardening
- [x] Mentor JWT claim and `MentorGuard` for mentor-only routes — `mentor.guard.ts`; auth.service.ts handles MENTOR in `validateUser` + `refreshToken`
- [x] Co-founder JWT claim and `CoFounderGuard` for co-founder routes — `cofounder.guard.ts`; auth.service.ts handles COFOUNDER in `validateUser` + `refreshToken`
- [x] Investor portal: `InvestorGuard` created; applied to investor-authenticated routes in investor.controller.ts + documentary.controller.ts — applicants/admins receive 403

---

## P4 — Admin Ops Pages (Missing)

- [x] `/admin/cofounders` — roster, team assignments, weekly reports inbox — `frontend/src/app/admin/cofounders/page.tsx`
- [x] `/admin/mentors` — list, create, assign mentors to teams — `frontend/src/app/admin/mentors/page.tsx`
- [x] `/admin/sprints` — team sprint viewer, milestone progress, blockers, create sprint & milestones — `frontend/src/app/admin/sprints/page.tsx`
- [x] `/admin/documentary` — upload + publish documentary clips per team per week — `frontend/src/app/admin/documentary/page.tsx`
- [x] `/hub/cofounder` — co-founder card, resource request form with type selector, request history — `frontend/src/app/hub/cofounder/page.tsx`

---

## Stage 5 — GTM & Post-Investment (Future, Not Yet Scoped)

> Triggered only after a team receives investor funding. Platform commits to 3 years of active support before full handover.

- [ ] GTM dashboard — team-facing; goal tracking, channel experiments, acquisition metrics
- [ ] Handover readiness checklist — co-founder + admin jointly assess profitable + sustainable milestone
- [ ] Post-handover state — company marked HANDED_OVER in `CompanyEntity`; equity timer triggers transfer
- [ ] Long-term support tracking — support requests + resolution history for post-funded teams
- [ ] Alumni / archives page — graduated companies visible in `/archives` with outcome metrics

> These tasks are unblocked only after P2 (investor pitch + funding decisions) is complete.

---

## Priority Summary

| Priority | Area | Why it blocks |
|---|---|---|
| P0 | Mentor system | Spec violation — team changes bypass mentor |
| P0 | Email triggers | Applicant commitments unmet |
| P1 | Co-founder system | Stage 2+ cannot operate without it |
| P1 | Hub sprint + project pages | Founders have no sprint UI |
| P1 | Blocker log + weekly check-in | Core accountability mechanism |
| P2 | Documentary pipeline | Required before investor pitch |
| P2 | Investor pitch scheduling + decisions | Completes Stage 4 |
| P3 | Automated timeline enforcement | Makes platform self-running |
| P3 | WhatsApp triggers | Decide keep or cut |
| P4 | Admin ops pages | Operational efficiency |
