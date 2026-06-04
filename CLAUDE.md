# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cross-File Navigation

When working in this repo, consult the right file for each concern:

| File | Purpose |
|------|---------|
| `CLAUDE.md` ← you are here | Dev commands, architecture, business rules, security constraints |
| `TODO.md` | Prioritised backlog (P0–P4). Mark `[x]` + commit hash when done. |
| `DESIGN.md` | Canonical UI/design system spec — authoritative for all frontend decisions |
| `backend/.env.example` | Authoritative list of required env vars |
| `.github/workflows/deploy-azure.yml` | Full deployment pipeline |

**Update policy:** When you make a change that affects one of these files, update it in the same PR:
- Completed a backlog task → mark it `[x]` in `TODO.md`
- Changed an env var → update `backend/.env.example`
- Added or removed a DB migration step → note it in this file under "Infra Constraints"
- Changed the deployment pipeline → update the Deployment section below

---

## Repository Layout

```
backend/              NestJS REST API (port 3001)
frontend/             Next.js 16 web app (port 3000)
docker-compose.yml    Local Postgres 16 + Redis 7
DESIGN.md             Design system spec
TODO.md               Implementation backlog
proposals/            RFCs and partnership docs (reference only)
```

---

## Platform Overview

Aryavartham is a startup incubation platform (India's "Sandbox"). It takes individuals with raw ideas through a structured 180-day programme to a fundable, operating company. Every feature should be read in context of which programme stage it serves.

### Stage Map

| Stage | Programme Phase | Key Actions |
|-------|----------------|-------------|
| **0** | Application & Selection | Apply → interview → async video → cohort of 100 selected |
| **1** | Team Formation | Auto-group by idea category → mentor assigned → separation/join/create requests |
| **2** | Team Finalisation | Team locked → co-founder assigned → no membership changes after this |
| **3** | 90-Day MVP Sprint | Resources on demand → milestone tracking → blocker logs → cinematic documentation |
| **4** | Investor Pitch | Documentary shown first → live pitch → funding decisions |
| **5** | 90-Day GTM (funded teams) | Go-to-market, iteration, 3-year platform support → handover at profitable milestone |

The `Batch.status` field maps to these stages:
`FILLING → SCREENING → TEAM_FORMATION → PROCESSING → PENDING_CONSENT → FINALIZED → PRODUCTION`

### Roles

| Role | JWT `role` claim | What they can access |
|------|-----------------|----------------------|
| Applicant / Founder | `APPLICANT` | `/apply`, `/profile`, `/hub/*`, `/waiting` |
| Mentor | `MENTOR` (pending — see TODO P0) | Assigned teams, team change request queue |
| Co-Founder (staff) | `COFOUNDER` (pending — see TODO P1) | Team sprint/blocker dashboards, resource requests, weekly reports |
| Admin | `ADMIN` | All `/admin/*` routes (incl. `/admin/store/*` commerce + article moderation) |
| Investor | `INVESTOR` | `/investors/*` only |
| Store customer | `CUSTOMER` (separate `jwt-customer` strategy) | `/store`, `/cart`, `/checkout`, `/account`, `/orders/[id]`, `/articles/submit` — distinct identity from platform applicants; guests checkout via cart/order token hashes |

---

## Hard Business Rules (Code Must Enforce)

These are not soft suggestions — enforce them in service layer validation, not just frontend:

```
Cohort size: exactly 100 per batch
Team size: 5 ≤ n ≤ 25

Team change requests (SEPARATION, JOIN_EXISTING, CREATE_NEW):
  → require mentor approval BEFORE admin (enforced: mentorStatus must be APPROVED before admin can resolve)

New team (CREATE_NEW) requirements before it can lock:
  → minimum 5 committed members
  → all 5 core departments filled:
       Product, Operations, Resources, Sales & Marketing, + 1 any
  → must be achieved within assigned deadline or applicant is:
       forced into an existing team OR placed on next-batch waitlist (automated)

Team lock (Stage 2): no membership changes permitted after this point
Co-founder: exactly 1 platform staff member per locked team

MVP Phase: 90 days from team lock date
Investor Phase: triggered only after MVP sign-off by co-founder + admin
GTM Phase: 90 days, funded teams only
Platform support duration: 3 years post-investment
Handover trigger: profitable + sustainable — assessed jointly by co-founder + admin

Equity: platform holds 51%, founders hold 49%
        1000-day timer starts at team lock; full handover on expiry

── Commerce / storefront ──
Money: integer paise everywhere (no Float/Decimal). GST rates = integer basis points.
Stock: never oversell — reserve inside an advisory-locked tx (locks acquired in
       global ascending (skuId, warehouseId) order) + CAS, available >= 0 invariant.
       Reservations have a TTL; expiry releases them (cron).
Orders: Razorpay order is created ONLY after all DB reservations succeed (never
        charge a doomed order). Webhook capture is exactly-once (CAS). Single
        warehouse per order in v1 (else 409 NO_FULFILLABLE_WAREHOUSE).
Returns: 7-day window from delivery; FULL refund incl. proportional tax; NO
         restocking fee. Cumulative refunds may never exceed the order grand total.
Coupons: tier price first, then ONE coupon (capped by maxDiscount), no stacking;
         per-customer cap dedupes on normalized email (anti-farming).
Invoicing: ONE GST invoice per order, gapless FY-scoped number (SELECT ... FOR
           UPDATE); InvoiceLines copied VERBATIM from OrderItem snapshots (tax is
           never recomputed at invoice time). Single seller GSTIN (SiteSettings).
Media caps (service-enforced, min 0): product = 10 images + 1 video; article = 15
           images + 3 videos (row-reservation at presign closes the parallel race).
Articles: user submit → admin approve/reject → published; authors see ONLY view
          count on their own; richer metrics are admin-only.
```

---

## Security Constraints (Do Not Regress)

These were hardened in PRs and must not be undone:

- **`triggeredBy` in audit/event models is always sourced from the JWT** — never accept it from the request body (`4ebf502`)
- **Refresh tokens are stored hashed (bcrypt)** in `refresh_tokens` table — never store raw tokens (`9a5bb4a`)
- **Refresh tokens rotate on use** — each use issues a new pair and revokes the old one
- **`pgcrypto` extension was removed** from the migration chain (`888c39a`) — do not re-add it; migrations must resolve cleanly without it
- **`triggeredBy` / identity fields in request body are stripped** — all identity is pinned to the JWT at login (`17edb1a`, `3d9b73a`, `fdc0655`, `1788c00`)
- **WhatsApp WABA integration is live** — `WhatsappModule` is `@Global()`, controller wired at `GET/POST /api/whatsapp/webhook`, admin endpoints at `/api/admin/whatsapp/*`. Webhook HMAC validated via `WHATSAPP_APP_SECRET`; verify token guarded fail-closed. 16 template stubs registered. See `backend/src/modules/whatsapp/`
- **Article `body` is untrusted rich-text JSON** — stored verbatim and returned as-is by `GET /api/articles/:slug`. The storefront MUST render it through a sandboxed rich-text renderer (never `dangerouslySetInnerHTML` or equivalent) to avoid stored XSS. `coverS3Key` is server-validated against the article's own `articles/{id}/` prefix + a CONFIRMED media row (no cross-article key injection). Admin authorship/identity (`decidedByAdminId`) is always pinned from the AdminGuard JWT; public article responses never expose `viewCount`. See `backend/src/modules/articles/`
- **Store customer auth is a SEPARATE identity** — dedicated `jwt-customer` Passport strategy + `CustomerJwtGuard` (never falls through to the platform/admin validator). Customer passwords bcrypt; customer refresh tokens SHA-256-hashed + rotated in `refresh_tokens`. Guest carts/orders are authorized by SHA-256 token-hash match (`GuestCartGuard`/`GuestOrderGuard`) — a bare UUID is never sufficient. Product/tab-section content is also untrusted JSON → sandbox-render only.
- **Store Razorpay webhook is SEPARATE** (`POST /api/store/webhooks/razorpay`, secret `RAZORPAY_STORE_WEBHOOK_SECRET`) — raw-body HMAC + constant-time compare, fail-closed in prod, and OWNERSHIP-FILTERED (matches `Order.razorpayOrderId`; never touches pledge `Payment` rows). Courier webhook (`/api/store/webhooks/courier`, `COURIER_WEBHOOK_SECRET`) verifies HMAC and dedupes tracking events (synthesizes a stable id when the courier omits one — never inserts a NULL `courierEventId`).
- **Commerce integrity** — stock never oversells (advisory-lock + global lock-order + CAS + `available>=0`); refunds are cumulatively capped at the order total + `razorpayRefundId` unique; coupons redeem atomically with email-dedupe; invoice numbers are gapless (`FOR UPDATE`); media caps are row-reserved at presign. Do not regress these. See `backend/src/modules/{orders,inventory,coupons,invoicing,shipping,returns,store-realtime,store-jobs}/` and `docs/COMMERCE_ARCHITECTURE.md`.

---

## Development Commands

### Local Infrastructure
```bash
docker-compose up -d   # Postgres 16 on 5432, Redis 7 on 6379
```

### Backend (NestJS)
```bash
cd backend
npm install
cp .env.example .env       # fill in values
npm run start:dev          # watch mode
npm run build
npm run lint               # ESLint --fix
npm run test               # Jest unit tests
npm run test:e2e
npm run test -- --testPathPattern=src/modules/auth   # single module
```

### Frontend (Next.js)
```bash
cd frontend
npm install
npm run dev
npm run build
npm run lint
```

### Database
```bash
cd backend
npm run db:migrate     # prisma migrate dev — creates migration file + applies
npm run db:push        # schema push without migration file (dev iteration only)
npm run db:seed        # idempotent seed (admin account + test data)
npm run db:studio      # Prisma Studio GUI at localhost:5555
npm run db:generate    # regenerate Prisma client after schema edit
npm run db:reset       # wipe + re-migrate (dev only — destructive)
```

---

## Backend Architecture

### Module Pattern

Every feature lives in `backend/src/modules/<feature>/`:
```
<feature>.module.ts       NestJS module wiring
<feature>.controller.ts   HTTP routes, guards applied here
<feature>.service.ts      Business logic + all Prisma calls
dto/                      class-validator DTOs for request/response
```

Root module (`app.module.ts`) wires:
- **ThrottlerModule** — 3-tier: 6/min (strict), 100/min (standard), 1000/hr (long)
- **BullModule** — Redis job queue for async work (emails, notifications, cron)
- **ConfigModule** — global env vars via `@nestjs/config`
- **PrismaModule** — singleton `PrismaService`

### Auth

Two strategies, both yield the same JWT pair:
1. **OTP** — `POST /auth/request-otp` → `POST /auth/verify-otp` → `{ accessToken, refreshToken }`
2. **Google OAuth** — `POST /auth/google` with ID token → same response

`accessToken`: 15 min. `refreshToken`: 7 days, hashed in `refresh_tokens`, rotated on use.
JWT payload carries `sub`, `role`, and identity fields pinned at login.

Active guards: `JwtAuthGuard`, `AdminGuard`, `InvestorGuard`, `MentorGuard`, `CoFounderGuard`.

### Queue & Scheduled Jobs

Async work dispatched via BullMQ (`src/modules/jobs/`). `@nestjs/schedule` handles cron jobs (deadline enforcement, no-show detection). Redis is required at startup.

### Prisma Key Relationships

- `Applicant` — central entity; connects to Batch, Team, MatchingProfile, InterviewBooking, VideoSubmission, EquityHolder, Document
- `Batch` — drives programme lifecycle via `BatchStatus` enum
- `CompanyEntity` — 51/49 equity split + 1000-day handover timer per team
- `RefreshToken` — hashed only; indexed on `[userId]` and `[token]`
- All IDs: UUIDs (`@db.Uuid`). All column names: snake_case via `@map()`

### Module Inventory (What's Built vs Pending)

Built (platform): auth, applicant, batch, team, eligibility, question, document, email, project, sprint, ledger, payment, donation, equity, matching, investor (+ pitch events), training, analytics, chat, election, announcement, referral, interview, mentor, cofounder, documentary, whatsapp (shell only), settings

Built (commerce / storefront — see `docs/COMMERCE_ARCHITECTURE.md`): store-auth (customer + guest), catalog (products/skus/tabs/sections/categories), store-media (S3 presign + caps), tax (GST engine), inventory (multi-warehouse, reservations, movements), purchasing (suppliers/POs/receiving), coupons, cart, diy (guides/steps/BOM/bundles), orders (checkout + Razorpay + status + refunds), invoicing (GST PDF), shipping (courier abstraction + tracking), returns (RMA), store-realtime (`/store/stock` + `/store/orders` Socket.io gateways), store-jobs (reservation-expiry, reorder, courier-sync, analytics-rollup, viewcount), store-analytics, articles (submission/moderation/metrics)

**Not yet built** (see TODO):
- Mux/CloudFront integration for documentary streaming (currently S3 presigned URLs)
- WhatsApp decision (keep or remove) — P3 (module shell exists, no controllers)
- Commerce follow-ups DONE (`6256c31`/`8f27a5d`): Socket.io Redis adapter (cross-replica fan-out, `src/redis-io.adapter.ts`); real-Postgres integration suite (`npm run test:int`, 4 suites/23 tests vs `arya_test`); `ArticleStatus` now has DRAFT + ARCHIVED; admin product-LIST endpoint (`GET /admin/store/products`, all statuses) + presigned list thumbnails. Remaining: populate default warehouse state/GSTIN via `/admin/store/settings` before first prod invoice (ops); optional deeper checkout/refund e2e with a Razorpay test-mode client.

---

## Frontend Architecture

### Routing (Next.js 16 App Router)

> This is Next.js **16** — breaking changes from v13/14. Before touching server components, routing, or data fetching, read `node_modules/next/dist/docs/` for this version.

| Path | Stage | Audience |
|------|-------|----------|
| `/` | Public | Landing / marketing |
| `/login` | – | All |
| `/apply` | Stage 0 | Applicants |
| `/waiting` | Stage 0 | Applicants awaiting decision |
| `/profile` | Stage 0+ | Authenticated applicants |
| `/hub` | Stage 1+ | Cohort members |
| `/hub/team` | Stage 1+ | Team members |
| `/hub/mentor` | Stage 1 | Founders (mentor contact) — **not built** |
| `/hub/sprint` | Stage 3 | Founders (sprint + milestones) — **not built** |
| `/hub/project` | Stage 3 | Founders (project details) — **not built** |
| `/hub/cofounder` | Stage 2+ | Founders (co-founder contact) — **not built** |
| `/admin/*` | – | Platform admins (incl. `/admin/store/*` commerce + article moderation) |
| `/investors/*` | Stage 4 | Investors |
| `/pledge` | – | Public donors |
| `/` | Public | NEW premium marketing landing (builder/maker/community) |
| `/startup` | Public | The original "180-day startup" landing (moved here) |
| `/store`, `/store/[slug]`, `/store/[slug]/build` | Public | Storefront: catalog, product detail (dynamic tabs), DIY build |
| `/cart`, `/checkout`, `/orders/[id]`, `/account` | Public/Customer | Cart → Razorpay checkout → order tracking (guest or customer) |
| `/articles`, `/articles/[slug]`, `/articles/submit` | Public | Journal: list, detail, author submission |

### HTTP Client

Platform/admin calls go through `src/lib/api.ts` (the `api` singleton — attaches the platform/admin token). **Store customer/guest/public calls go through `src/lib/storeApi.ts`** (the `storeApi` singleton — isolated customer token slot + guest cart/order token headers). Never use `fetch` directly (except the presigned-S3 PUT inside `MediaUploader`). Platform auth: `src/lib/auth.tsx` (`useAuth`); store customer auth: `src/lib/storeAuth.tsx` (`useStoreAuth`). Real-time: `src/lib/storeSockets.ts`.

### Design layers
- Public marketing surfaces (`/`, `/store/*`, `/articles/*`) use the **`mkt-*` premium layer** (rounded/glossy/glow — DESIGN.md §7), wrapped in a `.mkt` container.
- Everything authenticated/operational (`/admin/*`, `/hub/*`, `/apply`, `/investors`) stays **strict DESIGN.md** (0px, matte, no shadow).

---

## Design System

Defined in `DESIGN.md` — that file is canonical. Summarised key constraints:

- **0px border radius everywhere** — buttons, inputs, cards, images, modals. No exceptions.
- **No box-shadows** — depth via tonal surface layering and 1px hairlines (`outline_variant` #C2C8C2)
- **Palette:**
  - `#133022` Forest Green (primary)
  - `#FEF9F0` Parchment (background)
  - `#FDFBF7` Alabaster (surface)
  - `#5B0902` Terracotta (accent — use sparingly)
- **Typography:** Newsreader (serif) for headlines/display; Public Sans / Satoshi for body/labels
- **Floating elements:** glassmorphism — `surface_variant` at 80% opacity + `backdrop-blur: 20px`
- Labels: uppercase, `0.05rem` letter-spacing

---

## Environment Variables

Backend (`backend/.env`, template at `backend/.env.example`):

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_HOST / REDIS_PORT / REDIS_PASSWORD` | Azure prod uses port 6380 with TLS |
| `JWT_SECRET / JWT_REFRESH_SECRET` | HS256, min 32 chars each |
| `JWT_EXPIRATION / JWT_REFRESH_EXPIRATION` | `15m` / `7d` |
| `AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY` | IAM for S3 + SES |
| `AWS_SES_FROM_EMAIL / AWS_S3_BUCKET` | `arya-documents` bucket |
| `GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET` | OAuth |
| `RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET` | Payments (pledges/donations) |
| `RAZORPAY_STORE_WEBHOOK_SECRET` | **Store orders webhook** — SEPARATE from the pledge secret (prod fail-fast). Configure a distinct webhook URL in the Razorpay dashboard. |
| `COURIER_WEBHOOK_SECRET` | Courier tracking webhook HMAC (prod fail-fast) |
| `SHIPROCKET_TOKEN / SHIPROCKET_BASE_URL` | Optional — enables the Shiprocket courier provider; absent ⇒ manual courier mode |
| `FRONTEND_URL` | CORS origin whitelist (also used by store Socket.io gateways) |
| `SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD` | Idempotent admin seed on startup |

Frontend needs only: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

Store CTA links + seller GST identity are **admin-configurable via SiteSettings** (not env): `discordUrl`, `storeUrl`, `articlesUrl` (landing CTAs), seller GSTIN + seller state code (GST/invoicing), courier provider selection — editable at `/admin/store/settings`.

---

## Deployment

Push to `main` triggers `.github/workflows/deploy-azure.yml`:

1. `prisma migrate deploy` — applies pending migrations to production DB
2. Idempotent seed (non-fatal)
3. Build + push Docker images to Azure Container Registry (`aryaprodacr`)
4. Deploy to Azure Container Apps: `arya-backend-api` (3001), `arya-frontend-web` (3000)
5. Autoscaling: 1–10 replicas; old revisions deactivated

### Infra Constraints

- **Azure Redis** — prod connects on port **6380 with TLS** (not 6379)
- **`pgcrypto` extension removed** (`888c39a`) — migrations must not reference it; all UUIDs are app-side `@default(uuid())`
- **S3 bucket name:** `arya-documents` (region: `ap-south-1`) — reused for product/article media + GST invoice PDFs
- **Container registry:** `aryaprodacr` in resource group `arya-prod-rg`
- **Commerce migrations** `20260610000001`–`20260610000010` (catalog→analytics) + `20260611000000` (shipment number + `orders.delivered_at`) apply cleanly via `prisma migrate deploy`. The `20260610000010` seed inserts a default warehouse (NULL state/GSTIN — populate via `/admin/store/settings` before the first real invoice) + GST tax classes + invoice/PO/RMA number sequences.
- **New deps:** `pdfkit` (GST invoice PDFs), `@nestjs/event-emitter` (domain events → gateways) on backend; `isomorphic-dompurify` (sanitized rich-text render) on frontend.
- **Scaling note:** store Socket.io gateways are in-process; for >1 replica add the **Socket.io Redis adapter** so `stock.updated`/`order.updated` fan out across replicas (the same applies to the existing chat gateway).
