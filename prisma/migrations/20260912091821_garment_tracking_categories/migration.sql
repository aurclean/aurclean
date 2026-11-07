-- CreateEnum
CREATE TYPE "TrackingCategory" AS ENUM ('TROUSERS', 'SHIRTS', 'TSHIRTS', 'JACKETS', 'DRESSES', 'SAREES', 'BEDSHEETS', 'OTHER');

-- CreateEnum
CREATE TYPE "GarmentScanOutcome" AS ENUM ('MATCH', 'WRONG_ORDER', 'WRONG_CATEGORY', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "GarmentExceptionType" AS ENUM ('MISSING', 'WRONG_ORDER', 'WRONG_GARMENT', 'WRONG_LOCATION', 'DUPLICATE_SCAN', 'NOT_SCANNED');

-- CreateEnum
CREATE TYPE "GarmentExceptionStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- AlterTable
ALTER TABLE "garment_types" ADD COLUMN     "trackingCategory" "TrackingCategory" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "garments" ADD COLUMN     "trackingCategory" "TrackingCategory" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "garment_scans" (
    "id" TEXT NOT NULL,
    "garmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "contextOrderId" TEXT,
    "branchId" TEXT NOT NULL,
    "trackingCategory" "TrackingCategory" NOT NULL,
    "stage" "ProcessingStage" NOT NULL,
    "outcome" "GarmentScanOutcome" NOT NULL DEFAULT 'MATCH',
    "location" TEXT,
    "note" TEXT,
    "scannedById" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garment_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_exceptions" (
    "id" TEXT NOT NULL,
    "garmentId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "GarmentExceptionType" NOT NULL,
    "status" "GarmentExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "detail" TEXT,
    "resolution" TEXT,
    "reportedById" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "garment_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "garment_scans_garmentId_scannedAt_idx" ON "garment_scans"("garmentId", "scannedAt");

-- CreateIndex
CREATE INDEX "garment_scans_orderId_idx" ON "garment_scans"("orderId");

-- CreateIndex
CREATE INDEX "garment_scans_branchId_scannedAt_idx" ON "garment_scans"("branchId", "scannedAt");

-- CreateIndex
CREATE INDEX "garment_scans_branchId_trackingCategory_stage_idx" ON "garment_scans"("branchId", "trackingCategory", "stage");

-- CreateIndex
CREATE INDEX "garment_scans_outcome_idx" ON "garment_scans"("outcome");

-- CreateIndex
CREATE INDEX "garment_exceptions_branchId_status_idx" ON "garment_exceptions"("branchId", "status");

-- CreateIndex
CREATE INDEX "garment_exceptions_garmentId_status_idx" ON "garment_exceptions"("garmentId", "status");

-- CreateIndex
CREATE INDEX "garment_exceptions_type_status_idx" ON "garment_exceptions"("type", "status");

-- CreateIndex
CREATE INDEX "garment_types_trackingCategory_idx" ON "garment_types"("trackingCategory");

-- CreateIndex
CREATE INDEX "garments_branchId_trackingCategory_status_idx" ON "garments"("branchId", "trackingCategory", "status");

-- AddForeignKey
ALTER TABLE "garment_scans" ADD CONSTRAINT "garment_scans_garmentId_fkey" FOREIGN KEY ("garmentId") REFERENCES "garments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_scans" ADD CONSTRAINT "garment_scans_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_scans" ADD CONSTRAINT "garment_scans_contextOrderId_fkey" FOREIGN KEY ("contextOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_scans" ADD CONSTRAINT "garment_scans_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_scans" ADD CONSTRAINT "garment_scans_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_exceptions" ADD CONSTRAINT "garment_exceptions_garmentId_fkey" FOREIGN KEY ("garmentId") REFERENCES "garments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_exceptions" ADD CONSTRAINT "garment_exceptions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_exceptions" ADD CONSTRAINT "garment_exceptions_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_exceptions" ADD CONSTRAINT "garment_exceptions_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Classify the existing catalogue into the tracking buckets the floor counts in.
UPDATE "garment_types" SET "trackingCategory" = CASE "code"
  WHEN 'PANT'        THEN 'TROUSERS'
  WHEN 'JEANS'       THEN 'TROUSERS'
  WHEN 'SHIRT'       THEN 'SHIRTS'
  WHEN 'TSHIRT'      THEN 'TSHIRTS'
  WHEN 'JACKET'      THEN 'JACKETS'
  WHEN 'BLAZER'      THEN 'JACKETS'
  WHEN 'SUIT'        THEN 'JACKETS'
  WHEN 'DRESS'       THEN 'DRESSES'
  WHEN 'SAREE'       THEN 'SAREES'
  WHEN 'KURTA'       THEN 'SAREES'
  WHEN 'BEDSHEET'    THEN 'BEDSHEETS'
  WHEN 'PILLOWCOVER' THEN 'BEDSHEETS'
  ELSE 'OTHER'
END::"TrackingCategory";

UPDATE "garments" g
SET "trackingCategory" = t."trackingCategory"
FROM "garment_types" t
WHERE t."id" = g."garmentTypeId";

-- Re-issue every garment id in the category-prefixed form (TR-1042), keeping
-- the QR payload and barcode in step with it, and leave each category's
-- sequence pointing past what has already been issued.
WITH renumbered AS (
  SELECT g."id",
         CASE g."trackingCategory"
           WHEN 'TROUSERS'  THEN 'TR'
           WHEN 'SHIRTS'    THEN 'SH'
           WHEN 'TSHIRTS'   THEN 'TS'
           WHEN 'JACKETS'   THEN 'JK'
           WHEN 'DRESSES'   THEN 'DR'
           WHEN 'SAREES'    THEN 'SR'
           WHEN 'BEDSHEETS' THEN 'BS'
           ELSE 'OT'
         END AS prefix,
         row_number() OVER (
           PARTITION BY g."trackingCategory" ORDER BY g."createdAt", g."garmentCode"
         ) AS seq
  FROM "garments" g
)
UPDATE "garments" g
SET "garmentCode"  = r.prefix || '-' || (1000 + r.seq)::text,
    "qrPayload"    = 'AURA:G:' || r.prefix || '-' || (1000 + r.seq)::text,
    "barcodeValue" = r.prefix || '-' || (1000 + r.seq)::text
FROM renumbered r
WHERE r."id" = g."id";

DELETE FROM "sequences" WHERE "key" = 'garment';

INSERT INTO "sequences" ("key", "value", "updatedAt")
SELECT 'garment:' || split_part(g."garmentCode", '-', 1),
       max(split_part(g."garmentCode", '-', 2)::int) - 1000,
       NOW()
FROM "garments" g
WHERE g."garmentCode" LIKE '%-%'
GROUP BY 1
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW();
