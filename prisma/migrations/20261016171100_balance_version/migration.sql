-- AlterTable
ALTER TABLE "InventoryBalance" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InventoryCountItem" ADD COLUMN     "expectedVersion" INTEGER;
