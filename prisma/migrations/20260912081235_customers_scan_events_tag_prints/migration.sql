-- CreateEnum
CREATE TYPE "ScanTargetKind" AS ENUM ('ORDER', 'GARMENT', 'SLOT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ScanSource" AS ENUM ('KEYBOARD', 'CAMERA', 'HARDWARE');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "tagLastPrintedAt" TIMESTAMP(3),
ADD COLUMN     "tagPrintCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "landmark" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lastOrderAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_events" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "rawCode" TEXT NOT NULL,
    "resolvedAs" "ScanTargetKind" NOT NULL DEFAULT 'UNKNOWN',
    "orderId" TEXT,
    "garmentCode" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "action" TEXT,
    "source" "ScanSource" NOT NULL DEFAULT 'KEYBOARD',
    "scannedById" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_branchId_name_idx" ON "customers"("branchId", "name");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_branchId_phone_key" ON "customers"("branchId", "phone");

-- CreateIndex
CREATE INDEX "scan_events_branchId_scannedAt_idx" ON "scan_events"("branchId", "scannedAt");

-- CreateIndex
CREATE INDEX "scan_events_orderId_idx" ON "scan_events"("orderId");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: promote the customer details already denormalised on orders into
-- first-class customer rows, one per (branch, phone), and link the orders back.
INSERT INTO "customers" (
  "id", "code", "branchId", "name", "phone", "email",
  "addressLine", "city", "pincode", "landmark",
  "orderCount", "totalSpent", "outstandingAmount", "lastOrderAt",
  "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text),
  'CUS' || lpad((10000 + row_number() OVER (ORDER BY min(o."placedAt")))::text, 5, '0'),
  o."branchId",
  (array_agg(o."customerName" ORDER BY o."placedAt" DESC))[1],
  o."customerPhone",
  (array_agg(o."customerEmail" ORDER BY o."placedAt" DESC) FILTER (WHERE o."customerEmail" IS NOT NULL))[1],
  (array_agg(o."addressLine" ORDER BY o."placedAt" DESC) FILTER (WHERE o."addressLine" IS NOT NULL))[1],
  (array_agg(o."city" ORDER BY o."placedAt" DESC) FILTER (WHERE o."city" IS NOT NULL))[1],
  (array_agg(o."pincode" ORDER BY o."placedAt" DESC) FILTER (WHERE o."pincode" IS NOT NULL))[1],
  (array_agg(o."landmark" ORDER BY o."placedAt" DESC) FILTER (WHERE o."landmark" IS NOT NULL))[1],
  count(*) FILTER (WHERE o."status" <> 'CANCELLED'),
  coalesce(sum(o."paidAmount") FILTER (WHERE o."status" <> 'CANCELLED'), 0),
  coalesce(sum(o."outstandingAmount") FILTER (WHERE o."status" NOT IN ('CANCELLED', 'REFUNDED')), 0),
  max(o."placedAt"),
  now(),
  now()
FROM "orders" o
GROUP BY o."branchId", o."customerPhone";

UPDATE "orders" o
SET "customerId" = c."id"
FROM "customers" c
WHERE c."branchId" = o."branchId" AND c."phone" = o."customerPhone";
