-- AlterEnum
BEGIN;
CREATE TYPE "GarmentExceptionType_new" AS ENUM ('MISSING', 'WRONG_ORDER', 'WRONG_GARMENT', 'DUPLICATE_SCAN', 'NOT_SCANNED');
ALTER TABLE "garment_exceptions" ALTER COLUMN "type" TYPE "GarmentExceptionType_new" USING ("type"::text::"GarmentExceptionType_new");
ALTER TYPE "GarmentExceptionType" RENAME TO "GarmentExceptionType_old";
ALTER TYPE "GarmentExceptionType_new" RENAME TO "GarmentExceptionType";
DROP TYPE "public"."GarmentExceptionType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('SUPER_ADMIN', 'MANAGER', 'SCANNER');
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "role_permissions" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'SCANNER';
COMMIT;

-- DropForeignKey
ALTER TABLE "garment_location_history" DROP CONSTRAINT "garment_location_history_branchId_fkey";

-- DropForeignKey
ALTER TABLE "garment_location_history" DROP CONSTRAINT "garment_location_history_fromSlotId_fkey";

-- DropForeignKey
ALTER TABLE "garment_location_history" DROP CONSTRAINT "garment_location_history_garmentId_fkey";

-- DropForeignKey
ALTER TABLE "garment_location_history" DROP CONSTRAINT "garment_location_history_toSlotId_fkey";

-- DropForeignKey
ALTER TABLE "garment_location_history" DROP CONSTRAINT "garment_location_history_userId_fkey";

-- DropForeignKey
ALTER TABLE "garments" DROP CONSTRAINT "garments_rackSlotId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_rackSlotId_fkey";

-- DropForeignKey
ALTER TABLE "rack_slots" DROP CONSTRAINT "rack_slots_rackId_fkey";

-- DropForeignKey
ALTER TABLE "racks" DROP CONSTRAINT "racks_branchId_fkey";

-- DropIndex
DROP INDEX "garments_rackSlotId_idx";

-- DropIndex
DROP INDEX "orders_rackSlotId_idx";

-- AlterTable
ALTER TABLE "garments" DROP COLUMN "rackSlotId";

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "rackSlotId";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'SCANNER';

-- DropTable
DROP TABLE "garment_location_history";

-- DropTable
DROP TABLE "rack_slots";

-- DropTable
DROP TABLE "racks";

