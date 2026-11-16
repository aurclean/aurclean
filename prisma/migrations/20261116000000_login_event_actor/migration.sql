-- Records WHO issued / regenerated / revoked an access code.
ALTER TABLE "login_events" ADD COLUMN "actorId" TEXT;
CREATE INDEX "login_events_actorId_idx" ON "login_events"("actorId");
