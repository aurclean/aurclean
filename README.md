# Aura Laundry ERP

A production laundry operating system built around the only chain that matters on a
laundry floor:

```
Order → Garment → Processing → Location → Delivery → Payment
```

Every piece of clothing that comes through the door gets its own identity, its own
QR/barcode tag and its own immutable history. The system can always answer the
question a counter gets asked twenty times a day — **"where is my shirt right now?"**

---

## Contents

- [What this is](#what-this-is)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Demo accounts](#demo-accounts)
- [Architecture](#architecture)
- [Modules](#modules)
- [Roles and permissions](#roles-and-permissions)
- [Integrations](#integrations)
- [Security](#security)
- [Deployment](#deployment)
- [Project layout](#project-layout)

---

## What this is

This is not a generic ERP with a laundry skin. The data model and the screens are
shaped by how a laundry actually runs:

- **The garment is the unit of work**, not the order. An order with six shirts is six
  tracked garments, each with its own tag, its own pipeline and its own ledger.
- **The order is only as far along as its slowest garment.** Order status is derived
  from where the garments physically are, never set by hand and hoped for.
- **Storage is physical.** A packed order lives in Branch → Rack → Slot, and searching
  an order or garment code returns that location immediately.
- **Everything is branch-scoped.** Multi-branch is not a later migration; every
  operational record carries a `branchId` from day one.

Deliberately **not** built, per the brief: machine management, and a separate
customer/CRM module. Customer details live on the order, where billing, pickup and
delivery actually need them.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4, shadcn/ui component patterns, Lucide icons |
| Data | PostgreSQL + Prisma 7 (driver adapter, `prisma-client` generator) |
| Auth | Auth.js / NextAuth v5 (credentials) with database-backed RBAC |
| Validation | Zod on every server action and route handler |
| Charts | Recharts, on a CVD-validated categorical palette |
| Files | S3-compatible object storage (AWS S3 / Cloudflare R2 / Supabase) |
| Payments | Provider-abstracted — manual counter and Razorpay included |
| Messaging | In-app notices, plus optional transactional email — no WhatsApp or SMS gateway |

Server Components do the data work; Client Components appear only where there is
real interactivity (scanners, forms, charts, dialogs).

---

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+

### Setup

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#    Set DATABASE_URL and AUTH_SECRET at minimum.
#    Generate a secret with: openssl rand -base64 32

# 3. Create the schema
npx prisma migrate deploy      # or: npm run db:migrate  (development)

# 4. Load demo data
npm run db:seed

# 5. Run
npm run dev
```

Open <http://localhost:3000> and sign in with any account below.

### Useful scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Generate the Prisma client and build for production |
| `npm run typecheck` | `tsc --noEmit` across the project |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Re-seed demo data (clears transactional tables first) |
| `npm run db:studio` | Prisma Studio |

---

## Demo accounts

All demo accounts share the password **`Aura@Laundry1`**.

| Email | Role | What they see |
|---|---|---|
| `superadmin@auralaundry.example` | Super Admin | Everything, including settings and audit |
| `owner@auralaundry.example` | Owner | Everything across all branches |
| `manager@auralaundry.example` | Branch Manager | One branch, end to end |
| `counter@auralaundry.example` | Counter Staff | Booking, billing, garment lookup |
| `washing@auralaundry.example` | Washing Staff | Sorting, washing and drying stations |
| `ironing@auralaundry.example` | Ironing Staff | Ironing station |
| `qc@auralaundry.example` | QC Staff | Quality control, raising complaints |
| `packing@auralaundry.example` | Packing Staff | Packing station and rack filing |
| `driver@auralaundry.example` | Driver | Only their own pickups and deliveries |
| `accountant@auralaundry.example` | Accountant | Billing, purchases, expenses, reports |

Signing in as the washing staff account and opening `/billing` is the quickest way to
see the authorisation layer work.

---

## Architecture

### The order lifecycle

```
Received → Washing → Drying → Ironing → Packing → Ready → Delivered
```

That is the standard route through the shop, and what the order screens describe.
Sorting and quality control remain real workstations a service can opt into — the
seeded Premium Care route still runs a formal QC step — they are simply not on the
default pipeline.

With first-class support for partial delivery, cancellation, refund, rewash, rework
and failed delivery.

### The garment is the unit, not the order

An order is a billing envelope. The thing the shop physically handles is a single
piece, so that is the smallest thing the system tracks: an order of three
trousers, two shirts and a jacket is six `Garment` rows, six ids, six tags and
six independent histories, all pointing at one order number.

Each piece belongs to exactly one **tracking category** — trousers, shirts,
t-shirts, jackets, dresses, sarees, bedsheets or other — which decides the prefix
on its id and the tile it counts towards on the dashboard. Every category counts
on its own sequence, so `TR-1042` and `SH-1042` are different garments and an
operator knows what they are holding before they have read the number.

### Mismatch detection

Every station move writes a `GarmentScan`: which piece, which order, which
category, which station, when, and by whom. The mismatch engine reads those
against what each order says it holds and reports every way the two disagree —
🔴 missing, 🔴 wrong garment, 🔴 wrong order, 🔴 duplicate scan, 🟠 wrong rack,
🟠 never scanned, 🟢 correct.

Findings are derived on every read rather than stored, so a problem that has been
put right stops appearing by itself. The exception is a problem a person raised —
a garment reported missing — which lives in `GarmentException` until someone
closes it.

### How a garment moves

1. **Intake.** Booking an order creates one `Garment` per physical piece, each with a
   unique category-prefixed id (`TR-1042` — the forty-second pair of trousers this
   branch has taken in), a QR payload and a CODE128 barcode. It also creates that
   garment's `ProcessingTask` pipeline, derived from the stages configured on its
   service — a steam-iron order never queues at the washing station.
2. **Stations.** Each workstation shows only the garments it can actually action:
   a task whose earlier stages are still open is counted, not listed. An operator
   scans, picks an outcome, and the system advances the task, appends to the
   garment's immutable ledger, opens the next stage and re-derives the parent order's
   status — all in one transaction.
3. **Remediation.** A QC failure routes the garment back to washing and reopens every
   downstream stage. Rewash and rework increment their own counters, which feed the
   operations report.
4. **Storage.** Packing files the garment into a rack slot; that is the moment it
   becomes `READY`. The move is written to `GarmentLocationHistory`.
5. **Handover.** Dispatch marks garments out for delivery; completing the delivery
   hands them over, releases the rack slot, books any cash collected at the door and
   closes the order.

### Where state lives

The order header is a **derived** view of its garments, recomputed by
`recomputeOrderStatus` on every shop-floor event. An order sits at the station its
least-advanced garment is queued at. Money is derived the same way:
`recalcOrderPayments` re-reads captured payments and processed refunds rather than
trusting an incrementally maintained balance.

Customer lifetime figures follow the same rule: `recalcCustomerRollup` re-counts a
customer's orders, spend and outstanding balance whenever either changes. The order
still carries its own snapshot of the customer's name, phone and address, so editing
a directory entry never rewrites an invoice that has already been issued.

Four tables are append-only by contract:

- `GarmentStatusHistory` — every status change a garment has ever had
- `GarmentLocationHistory` — every physical move
- `GarmentScan` — every read of a garment tag at a station, and how it classified
- `ScanEvent` — every counter tag scan, successful or not, and what was done next

---

## Modules

| Module | Route | Highlights |
|---|---|---|
| Dashboard | `/dashboard` | Live operational counters, revenue and volume charts, station queue depth, branch performance. Filter by date, branch, service and status. |
| Orders | `/orders` | Booking with a customer directory lookup, live server-side pricing, GST, advances, invoice generation, lifecycle transitions, cancel/refund/rewash. |
| Categories | `/tracking` | Live piece count per category — trousers, shirts, t-shirts, jackets, dresses, sarees, bedsheets, other. Open one for every piece of that kind in the building with its order, customer, description, location, expected delivery, tag state and scan state. |
| Mismatch Center | `/mismatch` | Expected vs scanned vs actual, per category. Missing, wrong garment, wrong order, duplicate scan, wrong rack and never-scanned, each with the garment, customer, order, expected location, last scan and who made it — and Scan again, Move garment, Correct order, Report missing and View order to act on it. |
| Scan tag | `/scan` | The counter's scanner. Camera, QR, barcode or a USB/Bluetooth gun; resolves an order or garment tag to the order, with one-tap status changes, payment, tag reprint and a persistent scan history. Rescanning a tag reopens the order it already found. |
| Print tags | `/tags`, `/orders/:id/tags` | Thermal tag studio at 58 mm, 80 mm or a custom 40–120 mm width. Order tag, per-garment tags or both; print, reprint, print all, and a print preview. Prints are counted and audited. A separate GST receipt prints at `/orders/:id/receipt`. |
| Customers | `/customers` | Directory searchable by name, phone, customer code or an order number they placed. Order history, lifetime spend, balance owed, repeat indicator, and one-click booking from the profile. |
| Garments | `/garments` | Per-garment record, immutable ledger, stage timings, movement history, every scan of the tag, photos, printable tag. |
| Garment lookup | `/garments/scan` | Camera or hardware-scanner lookup answering "where is this piece?" with its full history. |
| Processing | `/processing` | One screen per station, scanner-first, large targets, bulk actions, QC failure routing. |
| Rack & location | `/racks` | Branch → rack → slot map with capacity and occupancy; click any slot to see what is in it. |
| Pickup & delivery | `/delivery`, `/driver` | Scheduling, driver assignment, dispatch, door-step collection, failed and rescheduled attempts, plus a mobile-first driver view. |
| Billing | `/billing` | Invoices, payments, refunds, outstanding ledger, UPI QR, Razorpay, payment reminders, printable GST invoices. |
| Inventory | `/inventory` | Branch-wise stock, movement ledger with running balances, transfers, adjustments, low-stock alerts. |
| Purchases | `/purchases` | Suppliers, purchase orders, goods receipts that post to stock, supplier invoices, payments, returns. |
| B2B | `/b2b` | Corporate accounts, contracts, rate cards applied automatically at order entry, credit limits, standing schedules, consolidated monthly statements. |
| Staff | `/staff` | Accounts, role assignment, per-user permission overrides, attendance, leave, productivity. |
| Complaints | `/complaints` | Typed complaints linked to an order or garment, photo evidence, investigation, and resolutions that actually act. |
| Reports | `/reports` | Sales, operations, delivery, inventory and finance, each exportable as CSV. |
| Settings | `/settings` | Branches, catalogue and rate matrix, notification templates and delivery log, expenses, audit log. |

---

## Roles and permissions

Ten roles ship out of the box. Authorisation is **permission-based, not role-based** —
every server action authorises against a permission code such as `orders.cancel` or
`processing.qc`, so access can be tuned per person without inventing new roles.

Effective access is:

```
role defaults  ∪  per-user grants  ∖  per-user revocations
```

Role defaults live in `src/lib/rbac.ts` and are seeded into `RolePermission`.
Overrides live in `UserPermission` and are editable from a staff member's profile.
A manager can never grant a permission they do not themselves hold, and only a super
admin can mint another super admin or owner.

Branch scoping is enforced separately and independently: `assertBranchAccess` and
`requireWriteBranch` pin non-global roles to their own branch regardless of what the
request asks for.

---

## Integrations

All three integration surfaces are interfaces with a working default, so a provider
can be swapped without touching feature code.

**Object storage** (`src/lib/providers/storage.ts`)
`STORAGE_DRIVER=local` writes to `./uploads` behind an authenticated route; `s3`,
`r2` and `supabase` all speak the S3 API. Uploads are type- and size-checked, and
keys are always server-generated — a client filename never reaches the bucket.

**Payments** (`src/lib/providers/payments.ts`)
`manual` covers cash, UPI on a static QR and card machines. `razorpay` creates orders
server-side and verifies the callback signature with a timing-safe comparison; a
webhook verifier is included. Credentials never leave the server — the browser only
ever sees the public key and an order id. `buildUpiIntentUri` generates a dynamic UPI
QR for the exact amount.

**Notifications** (`src/lib/providers/notifications.ts`)
The application does not integrate WhatsApp or SMS. Customer notices are raised
on the in-app channel — stored, listed in the notification centre, and read out
or printed at the counter — so a deployment needs no messaging credentials at
all. Transactional email is the one channel that reaches outside and stays
inert unless `EMAIL_API_KEY` and `EMAIL_FROM` are both set. Templates are
database-backed with `{{placeholder}}` substitution and a built-in fallback.
Delivery failures never roll back the business operation that triggered them;
each attempt is recorded in `NotificationLog`.

---

## Security

- **Authentication** — Auth.js credentials with bcrypt (cost 12) and a constant-work
  comparison so response timing does not reveal which accounts exist.
- **Authorisation** — checked server-side on every action and route handler. The
  middleware only checks that a session exists; it is never the security boundary.
- **Branch isolation** — enforced on both reads and writes.
- **Input validation** — Zod schemas on every mutation; errors come back as typed
  field errors rather than exceptions.
- **Audit logging** — every create, update and delete writes an `AuditLog` entry with
  actor, branch, before/after snapshots, IP and user agent. Secrets are redacted
  before anything is written.
- **Rate limiting** — on login (by IP *and* by account), scanning, mutations, uploads
  and report exports.
- **Uploads** — MIME and size allow-lists, server-generated keys, path-traversal
  guards, and `Content-Security-Policy: sandbox` on the local file route.
- **CSV export** — RFC 4180 quoting plus a formula-injection guard.
- **Database constraints** — foreign keys, unique constraints and indexes do the work
  the application layer should not be trusted with alone.
- **Secrets** — server-only environment variables. `src/lib/providers/*` are all
  marked `server-only`, so an accidental client import is a build error rather than a
  leak.

---

## Deployment

**Recommended:** Vercel + a managed PostgreSQL (Neon, Supabase, RDS) + S3/R2.

1. Push to GitHub and import the repository into Vercel.
2. Set the environment variables from `.env.example`. At minimum: `DATABASE_URL`,
   `AUTH_SECRET`, `NEXTAUTH_URL`.
3. Point `STORAGE_DRIVER` at real object storage — the `local` driver writes to the
   instance's filesystem and will not survive a deploy.
4. Run `npx prisma migrate deploy` against the production database as part of your
   release step.
5. Create the first Super Admin. The simplest route is to run the seed once against a
   fresh database and then change that account's password and email — or insert a user
   directly with a bcrypt hash.

The build runs `prisma generate` first, so a cold CI cache is fine.

---

## Project layout

```
prisma/
  schema.prisma            Full data model
  migrations/              Versioned SQL
  seed.ts                  Demo business: branches, staff, orders, garments, history

src/
  app/
    (app)/                 Authenticated application shell
      dashboard/ orders/ garments/ processing/ racks/ delivery/ driver/
      billing/ inventory/ purchases/ b2b/ staff/ complaints/ reports/ settings/
    api/                   Auth, file serving, code lookup, CSV export
    login/                 Credentials sign-in

  components/
    ui/                    shadcn/ui primitives
    shared/                Tables, filters, pagination, badges, scanner, QR/barcode
    charts/                Recharts wrappers on a validated palette
    layout/                Sidebar, topbar, app shell, navigation config

  lib/
    services/              Domain logic: orders, garments, processing, pricing,
                           inventory, analytics, notifications
    providers/             Storage, payments, notification transports
    validations/           Zod schemas, one module per domain
    rbac.ts                Permission catalogue and role matrix
    session.ts             Authorisation and branch-scoping helpers
    workflow.ts            Stage machine, transitions, status labels and tones
    audit.ts               Audit trail
```

Each feature folder keeps its `actions.ts` (server actions) next to the pages that
use them, so a module is legible in one place.
"# aurclean" 
