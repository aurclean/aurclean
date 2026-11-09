-- Composite indexes for firm-scoped dashboard, alert and list queries.
-- Additive only: creates indexes, changes no data.

-- CreateIndex
CREATE INDEX "audit_logs_firmId_createdAt_idx" ON "audit_logs"("firmId", "createdAt");

-- CreateIndex
CREATE INDEX "complaints_firmId_status_idx" ON "complaints"("firmId", "status");

-- CreateIndex
CREATE INDEX "deliveries_firmId_status_idx" ON "deliveries"("firmId", "status");

-- CreateIndex
CREATE INDEX "expenses_firmId_expenseDate_idx" ON "expenses"("firmId", "expenseDate");

-- CreateIndex
CREATE INDEX "garments_firmId_status_idx" ON "garments"("firmId", "status");

-- CreateIndex
CREATE INDEX "garments_firmId_branchId_status_idx" ON "garments"("firmId", "branchId", "status");

-- CreateIndex
CREATE INDEX "invoices_firmId_status_idx" ON "invoices"("firmId", "status");

-- CreateIndex
CREATE INDEX "invoices_firmId_issuedAt_idx" ON "invoices"("firmId", "issuedAt");

-- CreateIndex
CREATE INDEX "notifications_firmId_status_createdAt_idx" ON "notifications"("firmId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_firmId_branchId_status_idx" ON "orders"("firmId", "branchId", "status");

-- CreateIndex
CREATE INDEX "orders_firmId_status_expectedDeliveryAt_idx" ON "orders"("firmId", "status", "expectedDeliveryAt");

-- CreateIndex
CREATE INDEX "payments_firmId_paidAt_idx" ON "payments"("firmId", "paidAt");

-- CreateIndex
CREATE INDEX "pickups_firmId_status_idx" ON "pickups"("firmId", "status");

