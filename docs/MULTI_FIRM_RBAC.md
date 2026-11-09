# Multi-firm RBAC and per-firm WhatsApp

## Roles (exactly five)

| Role | Scope | Lands on | Can do |
|---|---|---|---|
| `PLATFORM_SUPER_ADMIN` | Platform; operates inside a firm only after explicitly entering it (banner + audit) | `/platform` | Create / edit / activate / deactivate / suspend firms, create Firm Manager + code, reset / revoke manager access, firm stats, WhatsApp **status** (never QR / messages) of every firm, platform activity |
| `FIRM_MANAGER` | One firm | `/dashboard` | Everything inside the firm: orders, customers, services, payments, documents, reports, staff (Field Manager / QC), WhatsApp connect / QR / disconnect / test / logs, firm settings |
| `FIELD_MANAGER` | One firm, **assigned jobs only** | `/field` | View / update assigned pickups and deliveries (accept, picked up, out for delivery, delivered, failed, notes). No money, no unassigned records |
| `QC` | One firm / branch | `/qc` | QC queue, pass, fail (note required), send for rework, QC history; processing stations |
| `CUSTOMER` | Own records | `/portal` | Own orders, tracking, QC status, invoices / payments, support. OTP on the firm's WhatsApp or a customer-specific link |

Legacy values were renamed in place by migration `20261109000000_five_role_model`:
`PLATFORM_ADMIN→PLATFORM_SUPER_ADMIN`, `SUPER_ADMIN→FIRM_MANAGER`, `MANAGER→FIELD_MANAGER` (least privilege), `SCANNER→QC`.

## Access codes

* 12 characters `XXXX-XXXX-XXXX` from a CSPRNG (≈60 bits), globally unique, shown once.
* Stored only as `HMAC-SHA256(pepper, code)` (`users.accessCodeHash`); never returned by any API.
* Legacy 6-digit codes keep working and are upgraded to hashes at next sign-in (or in bulk: `npm run db:harden-access-codes`).
* Regenerating invalidates the old code immediately; revoking blocks sign-in until a new code is issued.
* Every request re-checks the user is ACTIVE, has an un-revoked code, has the same role and firm, and the firm is ACTIVE — deactivation / revocation / suspension cut live sessions.
* Sign-in lockout: 8 failures per client address per 15 minutes (database-backed). Logins, failures, lockouts, logouts and code changes are in `login_events`.

## Deploy runbook

1. `pg_dump -Fc "$DATABASE_URL" > backup.dump`
2. Set `AUTH_SECRET` (and optionally `ACCESS_CODE_PEPPER`) — **the same values for the app, scripts and tests**, otherwise stored hashes will not match.
3. `npx prisma migrate deploy`
4. `npm run db:harden-access-codes`
5. `npx tsx prisma/sync-permissions.ts` (permissions are read from the database)
6. First platform admin on a fresh install: `npm run platform:create-admin -- "Name" email`
7. WhatsApp gateway: `OPENWA_API_KEY=… OPENWA_WEBHOOK_URL=https://<app>/api/whatsapp/webhook npm run whatsapp:server`. Each firm links its own number from **WhatsApp Settings**. Session ids are `whatsapp_<firm code>` (sessions created earlier keep their stored `wa_<firmId>` name so their paired login survives).

## Tests

* `npm run test:documents` – invoice / challan PDFs (real DB)
* `npm run test:whatsapp` – per-firm WhatsApp routing (real gateway process + protocol stub)
* `npm run test:multifirm` – end-to-end through the production server in a phone-sized browser (server must be running; `BASE_URL`)
