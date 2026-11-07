-- Replace email/password auth with a single access-code credential.
-- Existing rows get a temporary unique placeholder so the NOT NULL/UNIQUE
-- constraints can be added without data loss; the seed script (or an admin
-- via "Regenerate access code") assigns each account its real code.

ALTER TABLE "users" ADD COLUMN "accessCode" TEXT;

UPDATE "users" SET "accessCode" = 'TEMP_' || "id" WHERE "accessCode" IS NULL;

ALTER TABLE "users" ALTER COLUMN "accessCode" SET NOT NULL;

CREATE UNIQUE INDEX "users_accessCode_key" ON "users"("accessCode");

ALTER TABLE "users" DROP COLUMN "mustChangePassword";
ALTER TABLE "users" DROP COLUMN "passwordHash";
