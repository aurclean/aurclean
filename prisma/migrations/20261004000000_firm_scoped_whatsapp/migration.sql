-- Firm-scoped WhatsApp: one gateway session per firm, firm-owned message history.
-- BACK UP THE DATABASE BEFORE APPLYING. Additive/backfilling only: no rows are
-- deleted. Compare `SELECT count(*)` on whatsapp_logs and whatsapp_sessions
-- before and after; the counts must be identical.

-- ── whatsapp_sessions ────────────────────────────────────────────────
ALTER TABLE "whatsapp_sessions"
  ADD COLUMN "provider"      TEXT NOT NULL DEFAULT 'openwa',
  ADD COLUMN "displayName"   TEXT,
  ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "whatsapp_sessions" ALTER COLUMN "apiStatus" SET DEFAULT 'NOT_CONFIGURED';
ALTER TABLE "whatsapp_sessions" ALTER COLUMN "sessionName" DROP DEFAULT;

-- The old global-session design let several firms point at the same gateway
-- session name. The oldest firm keeps the shared name (it owns the paired
-- WhatsApp login); every other firm is moved onto its own wa_<firmId> session,
-- marked disconnected so it must scan its own QR.
WITH ranked AS (
  SELECT s."id", s."firmId",
         row_number() OVER (PARTITION BY s."sessionName" ORDER BY f."createdAt", s."createdAt", s."id") AS rn
  FROM "whatsapp_sessions" s JOIN "firms" f ON f."id" = s."firmId"
)
UPDATE "whatsapp_sessions" s
SET "sessionName" = 'wa_' || s."firmId",
    "isConnected" = false, "connectedNumber" = NULL, "qrCode" = NULL, "apiStatus" = 'DISCONNECTED'
FROM ranked r WHERE r."id" = s."id" AND r.rn > 1;

-- A firm keeps one row per provider; extra (cache-only) rows are retained under a legacy provider tag.
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "firmId" ORDER BY "isConnected" DESC, "updatedAt" DESC, "id") AS rn
  FROM "whatsapp_sessions"
)
UPDATE "whatsapp_sessions" s SET "provider" = 'legacy-' || s."id"
FROM ranked r WHERE r."id" = s."id" AND r.rn > 1;

DROP INDEX "whatsapp_sessions_firmId_sessionName_key";
CREATE UNIQUE INDEX "whatsapp_sessions_sessionName_key" ON "whatsapp_sessions"("sessionName");
CREATE UNIQUE INDEX "whatsapp_sessions_firmId_provider_key" ON "whatsapp_sessions"("firmId", "provider");

-- ── whatsapp_logs ────────────────────────────────────────────────────
ALTER TABLE "whatsapp_logs"
  ADD COLUMN "firmId"       TEXT,
  ADD COLUMN "sessionId"    TEXT,
  ADD COLUMN "documentType" TEXT,
  ADD COLUMN "documentId"   TEXT;

UPDATE "whatsapp_logs" l SET "firmId" = c."firmId" FROM "customers" c WHERE l."customerId" = c."id" AND l."firmId" IS NULL;
UPDATE "whatsapp_logs" l SET "firmId" = o."firmId" FROM "orders" o    WHERE l."orderId"    = o."id" AND l."firmId" IS NULL;
UPDATE "whatsapp_logs" l SET "firmId" = u."firmId" FROM "users" u     WHERE l."sentByUserId" = u."id" AND u."firmId" IS NOT NULL AND l."firmId" IS NULL;
-- Remaining orphans predate multi-firm and belong to the original AURCLEAN firm.
UPDATE "whatsapp_logs" SET "firmId" = 'firm_aurclean_falnir' WHERE "firmId" IS NULL;

ALTER TABLE "whatsapp_logs" ALTER COLUMN "firmId" SET NOT NULL;
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "whatsapp_logs_firmId_sentAt_idx" ON "whatsapp_logs"("firmId", "sentAt");
CREATE INDEX "whatsapp_logs_externalId_idx" ON "whatsapp_logs"("externalId");
