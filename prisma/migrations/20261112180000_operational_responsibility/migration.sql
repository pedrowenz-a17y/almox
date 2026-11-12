-- Etapa 3: registros novos; não altera saldos, contas ou permissões existentes.
BEGIN;

-- CreateTable
CREATE TABLE "WarehouseShift" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "responsibleId" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedById" UUID,
    "handoverToId" UUID,
    "handoverNote" TEXT NOT NULL DEFAULT '',
    "handoverRequestedAt" TIMESTAMP(3),
    "closeNote" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WarehouseShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingAssignment" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "itemKey" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "assigneeId" UUID NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,
    "managedById" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseShift_unitId_warehouseId_startedAt_idx" ON "WarehouseShift"("unitId", "warehouseId", "startedAt");

-- CreateIndex
CREATE INDEX "WarehouseShift_responsibleId_idx" ON "WarehouseShift"("responsibleId");

-- CreateIndex
CREATE INDEX "PendingAssignment_unitId_assigneeId_dueAt_idx" ON "PendingAssignment"("unitId", "assigneeId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingAssignment_unitId_itemKey_occurrenceKey_key" ON "PendingAssignment"("unitId", "itemKey", "occurrenceKey");

-- AddForeignKey
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_unitId_warehouseId_fkey" FOREIGN KEY ("unitId", "warehouseId") REFERENCES "Warehouse"("unitId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_handoverToId_fkey" FOREIGN KEY ("handoverToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAssignment" ADD CONSTRAINT "PendingAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAssignment" ADD CONSTRAINT "PendingAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAssignment" ADD CONSTRAINT "PendingAssignment_managedById_fkey" FOREIGN KEY ("managedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A warehouse cannot have two active responsible people.
CREATE UNIQUE INDEX "WarehouseShift_one_active_idx" ON "WarehouseShift" ("unitId", "warehouseId") WHERE "endedAt" IS NULL;
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_handover_pair" CHECK (("handoverToId" IS NULL) = ("handoverRequestedAt" IS NULL));
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_different_incoming" CHECK ("handoverToId" IS NULL OR "handoverToId" <> "responsibleId");
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_end_pair" CHECK (("endedAt" IS NULL) = ("endedById" IS NULL));
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_positive_version" CHECK (version > 0);
ALTER TABLE "PendingAssignment" ADD CONSTRAINT "PendingAssignment_positive_version" CHECK (version > 0);
-- Access is through authenticated, unit-scoped server routes, never the public data API.
DO $$
DECLARE table_name text; api_role text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['WarehouseShift','PendingAssignment'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, api_role);
   END IF;
  END LOOP;
 END LOOP;
END;
$$;

COMMIT;
