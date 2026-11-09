-- Adds firmId to the remaining firm-owned records named in the multi-firm
-- spec (Pickup, OrderItem, Notification). Columns are added nullable,
-- back-filled from the parent the row already belongs to, then locked to NOT
-- NULL. Nothing is deleted or rewritten except the new column.

ALTER TABLE "pickups"       ADD COLUMN "firmId" TEXT;
ALTER TABLE "order_items"   ADD COLUMN "firmId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "firmId" TEXT;

UPDATE "pickups"       p SET "firmId" = o."firmId" FROM "orders" o WHERE p."orderId" = o."id";
UPDATE "order_items"   i SET "firmId" = o."firmId" FROM "orders" o WHERE i."orderId" = o."id";
UPDATE "notifications" n SET "firmId" = o."firmId" FROM "orders" o WHERE n."orderId" = o."id" AND n."firmId" IS NULL;
UPDATE "notifications" n SET "firmId" = b."firmId" FROM "branches" b WHERE n."branchId" = b."id" AND n."firmId" IS NULL;

-- A notification with neither an order nor a branch can only be attributed
-- safely when the platform has exactly one firm; otherwise stop rather than guess.
DO $$
DECLARE
  firm_count integer;
  orphans integer;
BEGIN
  SELECT count(*) INTO firm_count FROM "firms";
  SELECT count(*) INTO orphans FROM "notifications" WHERE "firmId" IS NULL;
  IF orphans > 0 THEN
    IF firm_count = 1 THEN
      UPDATE "notifications" SET "firmId" = (SELECT "id" FROM "firms" LIMIT 1) WHERE "firmId" IS NULL;
    ELSE
      RAISE EXCEPTION 'Cannot attribute % notification(s) to a firm automatically; assign them manually, then re-run', orphans;
    END IF;
  END IF;
END $$;

ALTER TABLE "pickups"       ALTER COLUMN "firmId" SET NOT NULL;
ALTER TABLE "order_items"   ALTER COLUMN "firmId" SET NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "firmId" SET NOT NULL;

CREATE INDEX "pickups_firmId_idx"       ON "pickups"("firmId");
CREATE INDEX "order_items_firmId_idx"   ON "order_items"("firmId");
CREATE INDEX "notifications_firmId_idx" ON "notifications"("firmId");

ALTER TABLE "order_items"   ADD CONSTRAINT "order_items_firmId_fkey"   FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickups"       ADD CONSTRAINT "pickups_firmId_fkey"       FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
