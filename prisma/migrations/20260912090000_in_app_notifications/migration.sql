-- The application no longer talks to WhatsApp or SMS gateways. Customer
-- messaging is in-app (the counter reads it out, or hands over a printed tag)
-- with optional transactional email, so those two channels are folded into
-- IN_APP rather than left as dead enum values.
CREATE TYPE "NotificationChannel_new" AS ENUM ('IN_APP', 'EMAIL');

ALTER TABLE "notification_templates"
  ALTER COLUMN "channel" TYPE "NotificationChannel_new"
  USING (
    CASE "channel"::text
      WHEN 'EMAIL' THEN 'EMAIL'
      ELSE 'IN_APP'
    END
  )::"NotificationChannel_new";

ALTER TABLE "notifications"
  ALTER COLUMN "channel" TYPE "NotificationChannel_new"
  USING (
    CASE "channel"::text
      WHEN 'EMAIL' THEN 'EMAIL'
      ELSE 'IN_APP'
    END
  )::"NotificationChannel_new";

DROP TYPE "NotificationChannel";
ALTER TYPE "NotificationChannel_new" RENAME TO "NotificationChannel";

-- One template per event is enough once the channels collapse; keep the first
-- of each event and retire the duplicates.
DELETE FROM "notification_templates" t
USING "notification_templates" other
WHERE t."event" = other."event"
  AND t."channel" = other."channel"
  AND t."createdAt" > other."createdAt";
