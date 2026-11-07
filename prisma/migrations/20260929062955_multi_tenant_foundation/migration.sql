-- Multi-tenant foundation: add a Firm (tenant) model and give every
-- business-data table a firmId. All existing data is assigned to one
-- default firm ("Aurclean - Falnir") so nothing already in the database is
-- lost or reassigned incorrectly — see section 27 of the request this
-- migration implements.

-- 1. New role for the cross-firm platform operator.
ALTER TYPE "UserRole" ADD VALUE 'PLATFORM_ADMIN';

-- 2. Firm status enum + table.
CREATE TYPE "FirmStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "firms" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "status" "FirmStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "firms_code_key" ON "firms"("code");
CREATE INDEX "firms_status_idx" ON "firms"("status");

-- 3. The one pre-existing firm every current row is assigned to. A fixed,
-- predictable id (not a real cuid, but a valid primary key value) so the
-- rest of this migration can reference it directly without a lookup.
INSERT INTO "firms" ("id", "code", "name", "status", "createdAt", "updatedAt")
VALUES ('firm_aurclean_falnir', 'FALNIR', 'Aurclean - Falnir', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 4. Add firmId to every tenant-scoped table: add nullable, backfill every
-- existing row to the default firm above, then tighten to NOT NULL — safe
-- on a non-empty table in one migration, all in the same transaction.
-- (branches / users / audit_logs keep firmId nullable per-model below where
-- noted; every other table becomes required.)

ALTER TABLE "branches" ADD COLUMN "firmId" TEXT;
UPDATE "branches" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "branches" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "users" ADD COLUMN "firmId" TEXT;
UPDATE "users" SET "firmId" = 'firm_aurclean_falnir';
-- Stays nullable: a PLATFORM_ADMIN belongs to no single firm.

ALTER TABLE "audit_logs" ADD COLUMN "firmId" TEXT;
UPDATE "audit_logs" SET "firmId" = 'firm_aurclean_falnir';
-- Stays nullable: platform-level audit entries (e.g. firm creation) may
-- predate the firm they describe, or describe no firm at all.

ALTER TABLE "settings" ADD COLUMN "firmId" TEXT;
UPDATE "settings" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "settings" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "services" ADD COLUMN "firmId" TEXT;
UPDATE "services" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "services" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "garment_types" ADD COLUMN "firmId" TEXT;
UPDATE "garment_types" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "garment_types" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "orders" ADD COLUMN "firmId" TEXT;
UPDATE "orders" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "orders" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "garments" ADD COLUMN "firmId" TEXT;
UPDATE "garments" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "garments" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "invoices" ADD COLUMN "firmId" TEXT;
UPDATE "invoices" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "invoices" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "payments" ADD COLUMN "firmId" TEXT;
UPDATE "payments" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "payments" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "deliveries" ADD COLUMN "firmId" TEXT;
UPDATE "deliveries" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "deliveries" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "delivery_challans" ADD COLUMN "firmId" TEXT;
UPDATE "delivery_challans" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "delivery_challans" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "inventory_items" ADD COLUMN "firmId" TEXT;
UPDATE "inventory_items" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "inventory_items" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "suppliers" ADD COLUMN "firmId" TEXT;
UPDATE "suppliers" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "suppliers" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "purchase_orders" ADD COLUMN "firmId" TEXT;
UPDATE "purchase_orders" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "purchase_orders" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "b2b_accounts" ADD COLUMN "firmId" TEXT;
UPDATE "b2b_accounts" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "b2b_accounts" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "complaints" ADD COLUMN "firmId" TEXT;
UPDATE "complaints" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "complaints" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "expenses" ADD COLUMN "firmId" TEXT;
UPDATE "expenses" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "expenses" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "customers" ADD COLUMN "firmId" TEXT;
UPDATE "customers" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "customers" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "scan_events" ADD COLUMN "firmId" TEXT;
UPDATE "scan_events" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "scan_events" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "bank_accounts" ADD COLUMN "firmId" TEXT;
UPDATE "bank_accounts" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "bank_accounts" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "financial_ledgers" ADD COLUMN "firmId" TEXT;
UPDATE "financial_ledgers" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "financial_ledgers" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "cash_transactions" ADD COLUMN "firmId" TEXT;
UPDATE "cash_transactions" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "cash_transactions" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "whatsapp_templates" ADD COLUMN "firmId" TEXT;
UPDATE "whatsapp_templates" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "whatsapp_templates" ALTER COLUMN "firmId" SET NOT NULL;

ALTER TABLE "whatsapp_sessions" ADD COLUMN "firmId" TEXT;
UPDATE "whatsapp_sessions" SET "firmId" = 'firm_aurclean_falnir';
ALTER TABLE "whatsapp_sessions" ALTER COLUMN "firmId" SET NOT NULL;

-- 5. Foreign keys.
ALTER TABLE "branches" ADD CONSTRAINT "branches_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "settings" ADD CONSTRAINT "settings_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "garment_types" ADD CONSTRAINT "garment_types_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "garments" ADD CONSTRAINT "garments_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "b2b_accounts" ADD CONSTRAINT "b2b_accounts_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_ledgers" ADD CONSTRAINT "financial_ledgers_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Indexes for common tenant queries.
CREATE INDEX "branches_firmId_idx" ON "branches"("firmId");
CREATE INDEX "users_firmId_idx" ON "users"("firmId");
CREATE INDEX "audit_logs_firmId_idx" ON "audit_logs"("firmId");
CREATE INDEX "settings_firmId_idx" ON "settings"("firmId");
CREATE INDEX "services_firmId_idx" ON "services"("firmId");
CREATE INDEX "garment_types_firmId_idx" ON "garment_types"("firmId");
CREATE INDEX "orders_firmId_idx" ON "orders"("firmId");
CREATE INDEX "orders_firmId_status_idx" ON "orders"("firmId", "status");
CREATE INDEX "orders_firmId_placedAt_idx" ON "orders"("firmId", "placedAt");
CREATE INDEX "garments_firmId_idx" ON "garments"("firmId");
CREATE INDEX "invoices_firmId_idx" ON "invoices"("firmId");
CREATE INDEX "invoices_firmId_customerId_idx" ON "invoices"("firmId", "customerId");
CREATE INDEX "payments_firmId_idx" ON "payments"("firmId");
CREATE INDEX "payments_firmId_orderId_idx" ON "payments"("firmId", "orderId");
CREATE INDEX "deliveries_firmId_idx" ON "deliveries"("firmId");
CREATE INDEX "delivery_challans_firmId_idx" ON "delivery_challans"("firmId");
CREATE INDEX "inventory_items_firmId_idx" ON "inventory_items"("firmId");
CREATE INDEX "suppliers_firmId_idx" ON "suppliers"("firmId");
CREATE INDEX "purchase_orders_firmId_idx" ON "purchase_orders"("firmId");
CREATE INDEX "b2b_accounts_firmId_idx" ON "b2b_accounts"("firmId");
CREATE INDEX "complaints_firmId_idx" ON "complaints"("firmId");
CREATE INDEX "expenses_firmId_idx" ON "expenses"("firmId");
CREATE INDEX "customers_firmId_idx" ON "customers"("firmId");
CREATE INDEX "customers_firmId_phone_idx" ON "customers"("firmId", "phone");
CREATE INDEX "scan_events_firmId_idx" ON "scan_events"("firmId");
CREATE INDEX "bank_accounts_firmId_idx" ON "bank_accounts"("firmId");
CREATE INDEX "financial_ledgers_firmId_idx" ON "financial_ledgers"("firmId");
CREATE INDEX "cash_transactions_firmId_idx" ON "cash_transactions"("firmId");
CREATE INDEX "whatsapp_templates_firmId_idx" ON "whatsapp_templates"("firmId");
CREATE INDEX "whatsapp_sessions_firmId_idx" ON "whatsapp_sessions"("firmId");

-- 7. Convert catalog/global unique constraints to firm-scoped ones — each
-- firm gets its own branch codes, service/garment-type catalogue, supplier
-- list, inventory SKUs, WhatsApp session name and template set.
DROP INDEX "branches_code_key";
CREATE UNIQUE INDEX "branches_firmId_code_key" ON "branches"("firmId", "code");

DROP INDEX "services_code_key";
CREATE UNIQUE INDEX "services_firmId_code_key" ON "services"("firmId", "code");

DROP INDEX "garment_types_code_key";
CREATE UNIQUE INDEX "garment_types_firmId_code_key" ON "garment_types"("firmId", "code");

DROP INDEX "inventory_items_sku_key";
CREATE UNIQUE INDEX "inventory_items_firmId_sku_key" ON "inventory_items"("firmId", "sku");

DROP INDEX "suppliers_code_key";
CREATE UNIQUE INDEX "suppliers_firmId_code_key" ON "suppliers"("firmId", "code");

DROP INDEX "whatsapp_sessions_sessionName_key";
CREATE UNIQUE INDEX "whatsapp_sessions_firmId_sessionName_key" ON "whatsapp_sessions"("firmId", "sessionName");

DROP INDEX "whatsapp_templates_code_key";
CREATE UNIQUE INDEX "whatsapp_templates_firmId_code_key" ON "whatsapp_templates"("firmId", "code");

-- 8. Settings' primary key becomes (firmId, key) instead of just (key), so
-- each firm can have its own value for the same setting key.
ALTER TABLE "settings" DROP CONSTRAINT "settings_pkey";
ALTER TABLE "settings" ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("firmId", "key");
