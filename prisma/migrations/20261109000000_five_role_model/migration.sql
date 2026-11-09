-- Five-role model, hashed access codes, QC history, customer portal.
--
-- Safe, data-preserving migration:
--  * Role values are RENAMED IN PLACE (no row is rewritten or dropped):
--      PLATFORM_ADMIN -> PLATFORM_SUPER_ADMIN
--      SUPER_ADMIN    -> FIRM_MANAGER
--      MANAGER        -> FIELD_MANAGER   (least-privilege: the old office
--                                         manager role is retired; those
--                                         accounts keep working but lose
--                                         admin-level access until a Firm
--                                         Manager re-assigns them)
--      SCANNER        -> QC
--    plus the new CUSTOMER value. role_permissions rows follow automatically.
--  * accessCode becomes nullable; hashes are filled lazily at next sign-in
--    and in bulk by `npm run db:harden-access-codes`.
--  * Nothing is dropped. Pre-existing indexes are left untouched.

ALTER TYPE "UserRole" RENAME VALUE 'PLATFORM_ADMIN' TO 'PLATFORM_SUPER_ADMIN';
ALTER TYPE "UserRole" RENAME VALUE 'SUPER_ADMIN' TO 'FIRM_MANAGER';
ALTER TYPE "UserRole" RENAME VALUE 'MANAGER' TO 'FIELD_MANAGER';
ALTER TYPE "UserRole" RENAME VALUE 'SCANNER' TO 'QC';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CUSTOMER';
ALTER TYPE "FirmStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

-- CreateEnum
CREATE TYPE "QCResult" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'REWORK');

-- CreateEnum
CREATE TYPE "LoginEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGOUT', 'CODE_ISSUED', 'CODE_REGENERATED', 'CODE_REVOKED', 'OTP_REQUESTED');



-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "portalTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "portalTokenHash" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "accessCodeHash" TEXT,
ADD COLUMN     "accessCodeIssuedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ALTER COLUMN "accessCode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "whatsapp_sessions" ADD COLUMN     "health" JSONB,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "reconnectAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "firmId" TEXT,
    "userId" TEXT,
    "customerId" TEXT,
    "event" "LoginEventType" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_records" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "branchId" TEXT,
    "orderId" TEXT NOT NULL,
    "garmentId" TEXT NOT NULL,
    "inspectorId" TEXT,
    "result" "QCResult" NOT NULL,
    "notes" TEXT,
    "photoUrls" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_otps" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_events_firmId_createdAt_idx" ON "login_events"("firmId", "createdAt");

-- CreateIndex
CREATE INDEX "login_events_userId_createdAt_idx" ON "login_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "login_events_ip_event_createdAt_idx" ON "login_events"("ip", "event", "createdAt");

-- CreateIndex
CREATE INDEX "qc_records_firmId_result_createdAt_idx" ON "qc_records"("firmId", "result", "createdAt");

-- CreateIndex
CREATE INDEX "qc_records_garmentId_idx" ON "qc_records"("garmentId");

-- CreateIndex
CREATE INDEX "qc_records_orderId_idx" ON "qc_records"("orderId");

-- CreateIndex
CREATE INDEX "customer_otps_customerId_createdAt_idx" ON "customer_otps"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_otps_firmId_idx" ON "customer_otps"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_portalTokenHash_key" ON "customers"("portalTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "users_accessCodeHash_key" ON "users"("accessCodeHash");

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_records" ADD CONSTRAINT "qc_records_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_records" ADD CONSTRAINT "qc_records_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_records" ADD CONSTRAINT "qc_records_garmentId_fkey" FOREIGN KEY ("garmentId") REFERENCES "garments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_records" ADD CONSTRAINT "qc_records_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_otps" ADD CONSTRAINT "customer_otps_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

