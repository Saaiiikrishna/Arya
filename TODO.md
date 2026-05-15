# Aryavartham Platform — Implementation Backlog

> Last updated: 2026-05-15
> Tracking agent: Claude (claude-sonnet-4-6)
> When a task is completed, mark it `[x]` and add the commit hash in parentheses.

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

---

## P0 — Blockers (Platform Cannot Run Without These)

### Mentor System
> Team change requests must go through mentor approval per spec. Currently admin-only — spec violation.

- [ ] Add `Mentor` model to Prisma schema (user relation, assigned teams list, expertise)
- [ ] Migration for mentor table
- [ ] Mentor assignment endpoint — admin assigns mentor to team after auto-grouping
- [ ] Wire SEPARATION/JOIN_EXISTING/CREATE_NEW requests through mentor approval first, then admin
- [ ] Mentor portal dashboard (assigned teams, pending requests queue)
- [ ] JWT claim + guard for mentor-only routes
- [ ] Admin page `/admin/mentors` — list, assign, manage mentors
- [ ] Hub page `/hub/mentor` — founders see their mentor, can message

### Automated Email Triggers
> These are commitments to applicants; current email engine exists but zero event triggers are wired.

- [ ] Interview decision → email (SELECTED: welcome email, REJECTED: thank-you email)
- [ ] Team assignment → email to each cohort member with team details
- [ ] Deadline reminders: D-7, D-3, D-1 scheduled jobs for batch instruction deadlines
- [ ] Team lock confirmation → email to all team members
- [ ] Co-founder assignment → email to founding team
- [ ] MVP milestone completed → email notification
- [ ] Pitch invitation → email to team lead + co-founder
- [ ] No-show auto-detection: bookings with no decision after slot endTime → mark NO_SHOW + email

---

## P1 — Core Operations (Required for Stage 2+)

### Co-Founder System
> One platform staff per finalized team embedded as actual co-founder — currently no model or logic.

- [ ] Add `CoFounder` model (staff user, team, assigned date, report history)
- [ ] Migration for co-founder table
- [ ] Admin endpoint to assign co-founder to a locked team
- [ ] Co-founder portal — team sprint overview, blocker list, resource request form, weekly report submission
- [ ] `WeeklyReport` model + submission endpoint (co-founder → platform, weekly cadence)
- [ ] Admin inbox for weekly reports (all teams, current batch)
- [ ] `ResourceRequest` model — co-founder requests infra/tools/space/experts; admin fulfills; status tracked
- [ ] Email trigger: co-founder assigned → notify founding team

### Hub — Sprint & Project Pages (Frontend Only — Data Exists)
> Sprint and project data is in the DB but founders have no UI to see or interact with it.

- [ ] `/hub/sprint` — current sprint, milestone checklist, active blockers, check-in history
- [ ] `/hub/project` — project details editor (MVP description, tech stack, demo URL, status)

### Blocker Log & Weekly Check-in
- [ ] `BlockerLog` model (team, week, description, severity HIGH/MED/LOW, resolution status)
- [ ] `WeeklyCheckIn` model (team, week, progress summary, co-founder verified flag)
- [ ] Endpoints: submit check-in, log blocker, resolve blocker, co-founder verify check-in
- [ ] Hub sprint page shows active blockers and check-in status
- [ ] Admin/co-founder view: all teams' check-in status for current week

---

## P2 — Stage 4 Completion

### Documentary / Cinematic Pipeline
> The investor reel (reality-show style 90-day documentation) is a first-class feature per spec.

- [ ] `DocumentaryClip` model (team, week number, video URL, thumbnail, title, published flag)
- [ ] Upload endpoint (co-founder / production submits weekly clips via S3 signed URL)
- [ ] Admin review + publish toggle per clip
- [ ] Mux or Cloudflare Stream integration (replace raw S3 URLs with streaming player)
- [ ] Investor portal: documentary player page (clips in sequence, before pitch deck)

### Investor Pitch — Completion
- [ ] Pitch event scheduling (admin sets pitch date/time per team; distinct from general meeting requests)
- [ ] Investor interest tracking (shortlisted / passed per investor per startup)
- [ ] Post-pitch funding decision model (FUNDED / PASSED, amount, terms) per investor per team
- [ ] Admin page `/admin/pitch` — pitch calendar, investor assignments, decision recording

---

## P3 — Autonomy & Self-Running Platform

### Automated Timeline Enforcement
- [ ] Scheduled job: CREATE_NEW team deadline passes without all 5 depts filled → auto-assign applicant to existing team or next-batch waitlist + email
- [ ] Scheduled job: batch instruction deadline passes → mark overdue, send D-1 email, escalate
- [ ] Scheduled job: weekly check-in due every 7 days from team lock date → remind co-founder if not submitted
- [ ] Scheduled job: no-show detection (booking past endTime with no decision → mark NO_SHOW)

### WhatsApp Integration
> Module shell exists (`whatsapp.service.ts`) but zero controllers, zero triggers.

- [ ] Decision: implement Twilio/WABA receiver + outbound triggers (OTP, selection result, team assignment, deadline reminders) OR remove the module cleanly
- [ ] If implementing: wire into same event triggers as email (selection, team assign, deadlines)

### Role-Based Access Hardening
- [ ] Mentor JWT claim and `MentorGuard` for mentor-only routes
- [ ] Co-founder JWT claim and `CoFounderGuard` for co-founder routes
- [ ] Investor portal: verify `/investors/*` pages inaccessible to applicants and admins

---

## P4 — Admin Ops Pages (Missing)

- [ ] `/admin/cofounders` — roster, team assignments, weekly reports inbox
- [ ] `/admin/sprints` — all teams' sprint status, overdue milestones, blocker heatmap
- [ ] `/admin/documentary` — upload + publish documentary clips per team per week
- [ ] `/hub/cofounder` — co-founder contact, resource request form, report history (founder-facing)

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
