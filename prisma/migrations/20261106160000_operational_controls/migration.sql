ALTER TYPE "CountStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "InventoryCount" ADD COLUMN     "scheduleDueAt" TIMESTAMP(3),
ADD COLUMN     "scheduleId" UUID;

-- AlterTable
ALTER TABLE "OrderMaterial" ADD COLUMN     "invoicedUnitCost" DECIMAL(18,2),
ADD COLUMN     "pendingReturnQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InventorySchedule" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "assigneeId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCountId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationBatch" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "sourceName" TEXT NOT NULL,
    "referenceAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB NOT NULL,

    CONSTRAINT "ReconciliationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventorySchedule_unitId_active_nextDueAt_idx" ON "InventorySchedule"("unitId", "active", "nextDueAt");

-- CreateIndex
CREATE INDEX "InventorySchedule_locationId_idx" ON "InventorySchedule"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySchedule_unitId_id_key" ON "InventorySchedule"("unitId", "id");

-- CreateIndex
CREATE INDEX "ReconciliationBatch_unitId_createdAt_idx" ON "ReconciliationBatch"("unitId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationBatch_unitId_id_key" ON "ReconciliationBatch"("unitId", "id");

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "InventorySchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySchedule" ADD CONSTRAINT "InventorySchedule_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySchedule" ADD CONSTRAINT "InventorySchedule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySchedule" ADD CONSTRAINT "InventorySchedule_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySchedule" ADD CONSTRAINT "InventorySchedule_lastCountId_fkey" FOREIGN KEY ("lastCountId") REFERENCES "InventoryCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySchedule" ADD CONSTRAINT "InventorySchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationBatch" ADD CONSTRAINT "ReconciliationBatch_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationBatch" ADD CONSTRAINT "ReconciliationBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defaults preserve existing quantities. Historical identities and costs are not invented.
ALTER TABLE "OrderMaterial" ADD CONSTRAINT "OrderMaterial_pending_return_check" CHECK (
 "pendingReturnQuantity" >= 0 AND "pendingReturnQuantity" <= "appliedQuantity" + "consumedQuantity" - "returnedQuantity"
 AND ("invoicedUnitCost" IS NULL OR "invoicedUnitCost" >= 0)
);
ALTER TABLE "InventorySchedule" ADD CONSTRAINT "InventorySchedule_interval_check" CHECK ("intervalDays" BETWEEN 1 AND 365);
ALTER TABLE "ReconciliationBatch" ADD CONSTRAINT "ReconciliationBatch_kind_check" CHECK ("kind" IN ('STOCK', 'ORDER_COST'));
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_schedule_pair_check" CHECK (
 ("scheduleId" IS NULL AND "scheduleDueAt" IS NULL) OR ("scheduleId" IS NOT NULL AND "scheduleDueAt" IS NOT NULL)
);
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_scheduleId_same_unit_fkey" FOREIGN KEY ("unitId", "scheduleId") REFERENCES "InventorySchedule" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "InventorySchedule" ADD CONSTRAINT "InventorySchedule_locationId_same_unit_fkey" FOREIGN KEY ("unitId", "locationId") REFERENCES "Location" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "InventorySchedule" ADD CONSTRAINT "InventorySchedule_lastCountId_same_unit_fkey" FOREIGN KEY ("unitId", "lastCountId") REFERENCES "InventoryCount" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "InventorySchedule" ADD CONSTRAINT "InventorySchedule_assigneeId_same_unit_fkey" FOREIGN KEY ("assigneeId", "unitId") REFERENCES "UnitMembership" ("userId", "unitId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "InventorySchedule" ADD CONSTRAINT "InventorySchedule_createdById_same_unit_fkey" FOREIGN KEY ("createdById", "unitId") REFERENCES "UnitMembership" ("userId", "unitId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ReconciliationBatch" ADD CONSTRAINT "ReconciliationBatch_createdById_same_unit_fkey" FOREIGN KEY ("createdById", "unitId") REFERENCES "UnitMembership" ("userId", "unitId") DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER "InventorySchedule_scope_immutable" BEFORE UPDATE OF "unitId" ON "InventorySchedule" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "ReconciliationBatch_scope_immutable" BEFORE UPDATE OF "unitId" ON "ReconciliationBatch" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
-- A historical price is never replaced by today's mutable product cost.
CREATE FUNCTION almox_guard_invoiced_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD."invoicedUnitCost" IS NOT NULL OR OLD."consumedQuantity" > 0)
    AND NEW."invoicedUnitCost" IS DISTINCT FROM OLD."invoicedUnitCost" THEN
   RAISE EXCEPTION 'Invoiced cost snapshots are immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "OrderMaterial_cost_snapshot_immutable" BEFORE UPDATE OF "invoicedUnitCost" ON "OrderMaterial" FOR EACH ROW EXECUTE FUNCTION almox_guard_invoiced_cost();
REVOKE ALL ON FUNCTION almox_guard_invoiced_cost() FROM PUBLIC;
DO $$
DECLARE table_name text; api_role text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['InventorySchedule','ReconciliationBatch'] LOOP
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

-- At most one active proposal for a scheduled occurrence; rejected proposals remain in history.
CREATE UNIQUE INDEX "InventoryCount_schedule_pending_once_idx" ON "InventoryCount" ("scheduleId", "scheduleDueAt") WHERE "status" = 'PENDING' AND "scheduleId" IS NOT NULL;
