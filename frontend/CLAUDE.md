@AGENTS.md

# Frontend CLAUDE.md

This file provides frontend-specific guidance for Claude Code. Read the root [`../CLAUDE.md`](../CLAUDE.md) first for platform overview, business rules, and dev commands.

---

## Next.js Version Warning

This project uses **Next.js 16**, which has breaking changes from earlier versions. Before writing any routing, server component, or data-fetching code, read the relevant guide in `node_modules/next/dist/docs/`. Do not assume behaviour from Next.js 13/14 training data — APIs and conventions differ.

---

## Route Structure

All routes live under `src/app/` (App Router). The table below maps routes to programme stages and build status:

| Path | Stage | Status |
|------|-------|--------|
| `/` | Public | Built |
| `/login` | – | Built |
| `/apply` | Stage 0 | Built |
| `/waiting` | Stage 0 | Built |
| `/profile` | Stage 0+ | Built |
| `/hub` | Stage 1+ | Built |
| `/hub/team` | Stage 1+ | Built |
| `/hub/chat` | Stage 1+ | Built (Socket.io) |
| `/hub/mentor` | Stage 1 | Built — mentor card with bio, expertise tags, guidance note |
| `/hub/sprint` | Stage 3 | Built — milestone checklist, blockers, weekly check-ins |
| `/hub/project` | Stage 3 | Built — leader edit mode; status badge; funding target display |
| `/hub/cofounder` | Stage 2+ | Built — co-founder card, resource request form, request history |
| `/admin/*` | – | Built (core + mentors, cofounders, sprints — see TODO P4 for documentary) |
| `/investors/*` | Stage 4 | Built |
| `/pledge` | – | Built |
| `/archives` | – | Built |

---

## API Client

All backend calls must go through `src/lib/api.ts` — the Axios wrapper that attaches the auth header and sets `NEXT_PUBLIC_API_URL` as the base URL. Never call `fetch` directly.

Auth token management lives in `src/lib/auth.tsx`. The interceptor in `api.ts` reads from auth state, so components only need to call the api module, not manage headers themselves.

---

## Design System

All UI must follow **[`../DESIGN.md`](../DESIGN.md)** — that file is the canonical spec. Quick rules:

- **0px border-radius on everything** — no exceptions
- **No shadows** — use tonal surface layering and 1px `outline_variant` hairlines for depth
- Floating / overlay elements: glassmorphism (`surface_variant` at 80% opacity + `backdrop-blur: 20px`)
- Palette: Forest Green `#133022`, Parchment `#FEF9F0`, Alabaster `#FDFBF7`, Terracotta `#5B0902`
- Headlines: Newsreader (serif). Body/labels: Public Sans / Satoshi
- Labels: always uppercase, `0.05rem` letter-spacing
- No standard-blue links — use Forest Green or Terracotta

---

## Stage-Gating

Pages must be protected according to the role table in root `CLAUDE.md`. Auth guard logic lives in `src/lib/auth.tsx`. Key rules:

- `/hub/*` — applicant must have status `ACTIVE` or beyond; redirect unauthenticated users to `/login`
- `/admin/*` — `ADMIN` role only
- `/investors/*` — `INVESTOR` role only; applicants and admins must receive 403, not a redirect
- `/hub/sprint`, `/hub/project` — applicant must belong to a locked team (Stage 2+)
- `/hub/mentor`, `/hub/cofounder` — applicant must have an assigned mentor/co-founder

---

## Socket.io (Real-Time Chat)

Chat is implemented via `socket.io-client` in the hub chat page. The server requires a JWT in the connection handshake — use the access token from `src/lib/auth.tsx`. Room IDs are team IDs from the backend.

---

## Component Conventions

- Reusable components go in `src/components/`
- Admin-only components go in `src/components/admin/`
- Use `clsx` + `tailwind-merge` for conditional class names — both are already installed
- `lucide-react` for icons; `motion` (Framer Motion v12) for animation — use motion sparingly per DESIGN.md's editorial aesthetic
- Do not install shadcn/ui — the design system is custom (see DESIGN.md)

---

## Admin Ops Pages (P4 — Built)

All P4 admin ops pages are now wired into the Command Center dashboard:

- **`/admin/mentors`** — list, create, assign mentors to teams. Uses `listMentors()`, `createMentor()`, `assignMentorToTeam(mentorId, teamId)`.
- **`/admin/cofounders`** — tabbed view: Roster (list, create, assign to locked teams) + Weekly Reports inbox. Uses `listCoFounders()`, `createCoFounder()`, `assignCoFounderToTeam()`, `getAdminWeeklyReports(batchId?)`.
- **`/admin/sprints`** — batch + team selector; shows active sprint with milestone progress bar, overdue indicator, milestone list, active blockers. Admin can create sprint, add per-team milestone, or bulk-add milestone to all teams. Uses `adminGetSprintByTeam()`, `adminCreateSprint()`, `adminCreateMilestone()`, `adminCreateBulkMilestone()`, `getTeamBlockers()`.

Remaining P4 item: `/admin/documentary` (upload + publish cinematic clips per team/week — P2 priority).

## Hub Pages — All Core Pages Built

All P0/P1 hub pages are now complete. Remaining P4 items are admin-only.

## Recently Built Hub Pages

**`/hub/sprint`** (`src/app/hub/sprint/page.tsx`) — sprint dashboard with milestone progress bar, milestone checklist (CheckCircle2/Circle icons), active blockers with severity colour coding (HIGH=terracotta, MED/LOW=faded), inline log-blocker form with severity selector (HIGH/MED/LOW toggle), weekly check-in history, inline submit check-in form. API: `getMySprintDashboard()`, `logBlocker()`, `resolveBlocker()`, `submitCheckIn()`.

**`/hub/project`** (`src/app/hub/project/page.tsx`) — project details viewer/editor. Team leaders see an Edit button; members see read-only. Inline editing for projectName, targetMarket, description (textarea), estimatedFunds (number). Status badge shown. API: `getMyHub()` (includes project via team), `updateTeamProject(teamId, data)`.

## Note on `api.ts` Methods Added

- `getMySprintDashboard()` → `GET /sprints/my/dashboard`
- `logBlocker(teamId, body)` → `POST /sprints/teams/:teamId/blockers`
- `resolveBlocker(blockerId)` → `PATCH /sprints/blockers/:blockerId/resolve`
- `submitCheckIn(teamId, body)` → `POST /sprints/teams/:teamId/checkins`
- `getMyProject()` → `GET /applicants/me/project` (not yet implemented on backend)
- `updateTeamProject(teamId, data)` → `PATCH /teams/:teamId/project`
