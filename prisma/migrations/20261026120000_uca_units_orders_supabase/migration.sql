-- Additive migration: existing rows and identifiers are preserved.
-- Legacy operational rows remain unitId=NULL until approved mapping.
-- CreateEnum
CREATE TYPE "WorkOrderKind" AS ENUM ('SERVICE', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- DropIndex
DROP INDEX "Category_name_key";

-- DropIndex
DROP INDEX "Supplier_taxId_key";

-- DropIndex
DROP INDEX "Product_internalCode_key";

-- DropIndex
DROP INDEX "Product_sku_key";

-- DropIndex
DROP INDEX "Warehouse_code_key";

-- DropIndex
DROP INDEX "Location_code_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authUserId" UUID,
ALTER COLUMN "passwordHash" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "InventoryBalance" ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "orderMaterialId" UUID,
ADD COLUMN     "receiptItemId" UUID,
ADD COLUMN     "returnOfId" UUID,
ADD COLUMN     "unitId" UUID,
ADD COLUMN     "workOrderId" UUID;

-- AlterTable
ALTER TABLE "InventoryCount" ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "InventoryCountItem" ADD COLUMN     "expectedAppliedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "IdempotencyRecord" ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "unitId" UUID;

-- AlterTable
ALTER TABLE "ImageAsset" ADD COLUMN     "unitId" UUID;

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalUnit" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitMembership" (
    "userId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitMembership_pkey" PRIMARY KEY ("userId","unitId")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "WorkOrderKind" NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL DEFAULT '',
    "invoiceReference" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMaterial" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "requestedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reservedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "appliedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "consumedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "returnedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,

    CONSTRAINT "OrderMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "materialId" UUID,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(18,3),
    "note" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "supplierId" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL DEFAULT '',
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "orderedQuantity" DECIMAL(18,3) NOT NULL,
    "receivedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,2),

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "documentReference" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptItem" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "purchaseOrderItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,2),

    CONSTRAINT "ReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalUnit_code_key" ON "OperationalUnit"("code");

-- CreateIndex
CREATE INDEX "OperationalUnit_organizationId_idx" ON "OperationalUnit"("organizationId");

-- CreateIndex
CREATE INDEX "UnitMembership_unitId_active_idx" ON "UnitMembership"("unitId", "active");

-- CreateIndex
CREATE INDEX "UnitMembership_roleId_idx" ON "UnitMembership"("roleId");

-- CreateIndex
CREATE INDEX "WorkOrder_unitId_status_createdAt_idx" ON "WorkOrder"("unitId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_userId_idx" ON "WorkOrder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_unitId_code_key" ON "WorkOrder"("unitId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_unitId_id_key" ON "WorkOrder"("unitId", "id");

-- CreateIndex
CREATE INDEX "OrderMaterial_unitId_productId_locationId_idx" ON "OrderMaterial"("unitId", "productId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMaterial_orderId_productId_locationId_key" ON "OrderMaterial"("orderId", "productId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMaterial_unitId_id_key" ON "OrderMaterial"("unitId", "id");

-- CreateIndex
CREATE INDEX "OrderEvent_unitId_orderId_createdAt_idx" ON "OrderEvent"("unitId", "orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderEvent_materialId_idx" ON "OrderEvent"("materialId");

-- CreateIndex
CREATE INDEX "OrderEvent_userId_idx" ON "OrderEvent"("userId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_unitId_status_createdAt_idx" ON "PurchaseOrder"("unitId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_userId_idx" ON "PurchaseOrder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_unitId_code_key" ON "PurchaseOrder"("unitId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_unitId_id_key" ON "PurchaseOrder"("unitId", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_productId_key" ON "PurchaseOrderItem"("purchaseOrderId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_unitId_id_key" ON "PurchaseOrderItem"("unitId", "id");

-- CreateIndex
CREATE INDEX "Receipt_unitId_createdAt_idx" ON "Receipt"("unitId", "createdAt");

-- CreateIndex
CREATE INDEX "Receipt_purchaseOrderId_idx" ON "Receipt"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "Receipt_userId_idx" ON "Receipt"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_unitId_id_key" ON "Receipt"("unitId", "id");

-- CreateIndex
CREATE INDEX "ReceiptItem_receiptId_idx" ON "ReceiptItem"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptItem_purchaseOrderItemId_idx" ON "ReceiptItem"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "ReceiptItem_productId_idx" ON "ReceiptItem"("productId");

-- CreateIndex
CREATE INDEX "ReceiptItem_locationId_idx" ON "ReceiptItem"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptItem_unitId_id_key" ON "ReceiptItem"("unitId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE INDEX "Category_unitId_idx" ON "Category"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_unitId_name_key" ON "Category"("unitId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_unitId_id_key" ON "Category"("unitId", "id");

-- CreateIndex
CREATE INDEX "Supplier_unitId_idx" ON "Supplier"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_unitId_taxId_key" ON "Supplier"("unitId", "taxId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_unitId_id_key" ON "Supplier"("unitId", "id");

-- CreateIndex
CREATE INDEX "Product_unitId_idx" ON "Product"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_unitId_internalCode_key" ON "Product"("unitId", "internalCode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_unitId_sku_key" ON "Product"("unitId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_unitId_id_key" ON "Product"("unitId", "id");

-- CreateIndex
CREATE INDEX "Warehouse_unitId_idx" ON "Warehouse"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_unitId_code_key" ON "Warehouse"("unitId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_unitId_id_key" ON "Warehouse"("unitId", "id");

-- CreateIndex
CREATE INDEX "Location_unitId_idx" ON "Location"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_unitId_code_key" ON "Location"("unitId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Location_unitId_id_key" ON "Location"("unitId", "id");

-- CreateIndex
CREATE INDEX "InventoryBalance_unitId_idx" ON "InventoryBalance"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_receiptItemId_key" ON "StockMovement"("receiptItemId");

-- CreateIndex
CREATE INDEX "StockMovement_workOrderId_idx" ON "StockMovement"("workOrderId");

-- CreateIndex
CREATE INDEX "StockMovement_orderMaterialId_idx" ON "StockMovement"("orderMaterialId");

-- CreateIndex
CREATE INDEX "StockMovement_returnOfId_idx" ON "StockMovement"("returnOfId");

-- CreateIndex
CREATE INDEX "StockMovement_unitId_idx" ON "StockMovement"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_unitId_id_key" ON "StockMovement"("unitId", "id");

-- CreateIndex
CREATE INDEX "InventoryCount_unitId_idx" ON "InventoryCount"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_unitId_id_key" ON "InventoryCount"("unitId", "id");

-- CreateIndex
CREATE INDEX "InventoryCountItem_unitId_idx" ON "InventoryCountItem"("unitId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_unitId_idx" ON "IdempotencyRecord"("unitId");

-- CreateIndex
CREATE INDEX "AuditLog_unitId_idx" ON "AuditLog"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_unitId_key" ON "AppSettings"("unitId");

-- CreateIndex
CREATE INDEX "AppSettings_unitId_idx" ON "AppSettings"("unitId");

-- CreateIndex
CREATE INDEX "ImageAsset_unitId_idx" ON "ImageAsset"("unitId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderMaterialId_fkey" FOREIGN KEY ("orderMaterialId") REFERENCES "OrderMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_receiptItemId_fkey" FOREIGN KEY ("receiptItemId") REFERENCES "ReceiptItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_returnOfId_fkey" FOREIGN KEY ("returnOfId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalUnit" ADD CONSTRAINT "OperationalUnit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitMembership" ADD CONSTRAINT "UnitMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitMembership" ADD CONSTRAINT "UnitMembership_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitMembership" ADD CONSTRAINT "UnitMembership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMaterial" ADD CONSTRAINT "OrderMaterial_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMaterial" ADD CONSTRAINT "OrderMaterial_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMaterial" ADD CONSTRAINT "OrderMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMaterial" ADD CONSTRAINT "OrderMaterial_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "OrderMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OperationalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Composite foreign keys prevent cross-unit references. NULL preserves quarantined legacy rows.
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_same_unit_fkey" FOREIGN KEY ("unitId", "categoryId") REFERENCES "Category" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_same_unit_fkey" FOREIGN KEY ("unitId", "supplierId") REFERENCES "Supplier" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Location" ADD CONSTRAINT "Location_warehouseId_same_unit_fkey" FOREIGN KEY ("unitId", "warehouseId") REFERENCES "Warehouse" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_same_unit_fkey" FOREIGN KEY ("unitId", "parentId") REFERENCES "Location" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_productId_same_unit_fkey" FOREIGN KEY ("unitId", "productId") REFERENCES "Product" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_same_unit_fkey" FOREIGN KEY ("unitId", "locationId") REFERENCES "Location" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_same_unit_fkey" FOREIGN KEY ("unitId", "productId") REFERENCES "Product" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sourceId_same_unit_fkey" FOREIGN KEY ("unitId", "sourceId") REFERENCES "Location" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_destinationId_same_unit_fkey" FOREIGN KEY ("unitId", "destinationId") REFERENCES "Location" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_inventoryCountId_same_unit_fkey" FOREIGN KEY ("unitId", "inventoryCountId") REFERENCES "InventoryCount" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_workOrderId_same_unit_fkey" FOREIGN KEY ("unitId", "workOrderId") REFERENCES "WorkOrder" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderMaterialId_same_unit_fkey" FOREIGN KEY ("unitId", "orderMaterialId") REFERENCES "OrderMaterial" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_receiptItemId_same_unit_fkey" FOREIGN KEY ("unitId", "receiptItemId") REFERENCES "ReceiptItem" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_returnOfId_same_unit_fkey" FOREIGN KEY ("unitId", "returnOfId") REFERENCES "StockMovement" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_locationId_same_unit_fkey" FOREIGN KEY ("unitId", "locationId") REFERENCES "Location" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_countId_same_unit_fkey" FOREIGN KEY ("unitId", "countId") REFERENCES "InventoryCount" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_productId_same_unit_fkey" FOREIGN KEY ("unitId", "productId") REFERENCES "Product" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "OrderMaterial" ADD CONSTRAINT "OrderMaterial_orderId_same_unit_fkey" FOREIGN KEY ("unitId", "orderId") REFERENCES "WorkOrder" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "OrderMaterial" ADD CONSTRAINT "OrderMaterial_productId_same_unit_fkey" FOREIGN KEY ("unitId", "productId") REFERENCES "Product" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "OrderMaterial" ADD CONSTRAINT "OrderMaterial_locationId_same_unit_fkey" FOREIGN KEY ("unitId", "locationId") REFERENCES "Location" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_same_unit_fkey" FOREIGN KEY ("unitId", "orderId") REFERENCES "WorkOrder" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_materialId_same_unit_fkey" FOREIGN KEY ("unitId", "materialId") REFERENCES "OrderMaterial" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_same_unit_fkey" FOREIGN KEY ("unitId", "supplierId") REFERENCES "Supplier" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_same_unit_fkey" FOREIGN KEY ("unitId", "purchaseOrderId") REFERENCES "PurchaseOrder" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_same_unit_fkey" FOREIGN KEY ("unitId", "productId") REFERENCES "Product" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_purchaseOrderId_same_unit_fkey" FOREIGN KEY ("unitId", "purchaseOrderId") REFERENCES "PurchaseOrder" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_receiptId_same_unit_fkey" FOREIGN KEY ("unitId", "receiptId") REFERENCES "Receipt" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_purchaseOrderItemId_same_unit_fkey" FOREIGN KEY ("unitId", "purchaseOrderItemId") REFERENCES "PurchaseOrderItem" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_productId_same_unit_fkey" FOREIGN KEY ("unitId", "productId") REFERENCES "Product" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_locationId_same_unit_fkey" FOREIGN KEY ("unitId", "locationId") REFERENCES "Location" ("unitId", "id") DEFERRABLE INITIALLY DEFERRED;

-- Persistent arithmetic constraints supplement server validation.
ALTER TABLE "OrderMaterial" ADD CONSTRAINT "OrderMaterial_quantities_check" CHECK (
 "requestedQuantity" >= 0 AND "reservedQuantity" >= 0 AND "appliedQuantity" >= 0
 AND "consumedQuantity" >= 0 AND "returnedQuantity" >= 0
 AND "returnedQuantity" <= "consumedQuantity"
 AND "reservedQuantity" + "appliedQuantity" + "consumedQuantity" - "returnedQuantity" <= "requestedQuantity"
);
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_quantities_check" CHECK (
 "orderedQuantity" > 0 AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "orderedQuantity"
 AND ("unitCost" IS NULL OR "unitCost" >= 0)
);
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_quantity_check" CHECK (
 "quantity" > 0 AND ("unitCost" IS NULL OR "unitCost" >= 0)
);
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_quantity_check" CHECK ("quantity" IS NULL OR "quantity" > 0);
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_applied_check" CHECK ("expectedAppliedQuantity" >= 0);
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_invoice_state_check" CHECK (
 ("status" = 'INVOICED' AND "invoicedAt" IS NOT NULL AND "invoiceReference" IS NOT NULL AND length(trim("invoiceReference")) > 0)
 OR ("status" <> 'INVOICED' AND "invoicedAt" IS NULL AND "invoiceReference" IS NULL)
);
CREATE UNIQUE INDEX "StockMovement_order_consumption_once_idx" ON "StockMovement" ("orderMaterialId")
 WHERE "type" = 'EXIT' AND "workOrderId" IS NOT NULL AND "orderMaterialId" IS NOT NULL;

-- A scoped row can never be moved to another unit. Mapping NULL legacy scope is permitted.
CREATE FUNCTION almox_guard_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND OLD."unitId" IS NOT NULL AND NEW."unitId" IS DISTINCT FROM OLD."unitId" THEN
   RAISE EXCEPTION 'The operational unit of an existing record is immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "Category_scope_immutable" BEFORE UPDATE OF "unitId" ON "Category" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "Supplier_scope_immutable" BEFORE UPDATE OF "unitId" ON "Supplier" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "Product_scope_immutable" BEFORE UPDATE OF "unitId" ON "Product" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "Warehouse_scope_immutable" BEFORE UPDATE OF "unitId" ON "Warehouse" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "Location_scope_immutable" BEFORE UPDATE OF "unitId" ON "Location" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "InventoryBalance_scope_immutable" BEFORE UPDATE OF "unitId" ON "InventoryBalance" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "StockMovement_scope_immutable" BEFORE UPDATE OF "unitId" ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "InventoryCount_scope_immutable" BEFORE UPDATE OF "unitId" ON "InventoryCount" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "InventoryCountItem_scope_immutable" BEFORE UPDATE OF "unitId" ON "InventoryCountItem" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "IdempotencyRecord_scope_immutable" BEFORE UPDATE OF "unitId" ON "IdempotencyRecord" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "AuditLog_scope_immutable" BEFORE UPDATE OF "unitId" ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "AppSettings_scope_immutable" BEFORE UPDATE OF "unitId" ON "AppSettings" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "ImageAsset_scope_immutable" BEFORE UPDATE OF "unitId" ON "ImageAsset" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "WorkOrder_scope_immutable" BEFORE UPDATE OF "unitId" ON "WorkOrder" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "OrderMaterial_scope_immutable" BEFORE UPDATE OF "unitId" ON "OrderMaterial" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "OrderEvent_scope_immutable" BEFORE UPDATE OF "unitId" ON "OrderEvent" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "PurchaseOrder_scope_immutable" BEFORE UPDATE OF "unitId" ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "PurchaseOrderItem_scope_immutable" BEFORE UPDATE OF "unitId" ON "PurchaseOrderItem" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "Receipt_scope_immutable" BEFORE UPDATE OF "unitId" ON "Receipt" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();
CREATE TRIGGER "ReceiptItem_scope_immutable" BEFORE UPDATE OF "unitId" ON "ReceiptItem" FOR EACH ROW EXECUTE FUNCTION almox_guard_scope();

-- Operational tables are accessed only through the authenticated Next.js/Prisma server.
-- No public Data API grants or broad authenticated policies are installed.
DO $$
DECLARE table_name text; api_role text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['Role','Permission','RolePermission','User','Session','LoginAttempt','Category','Supplier','Product','Warehouse','Location','InventoryBalance','StockMovement','InventoryCount','InventoryCountItem','IdempotencyRecord','AuditLog','AppSettings','ImageAsset','Organization','OperationalUnit','UnitMembership','WorkOrder','OrderMaterial','OrderEvent','PurchaseOrder','PurchaseOrderItem','Receipt','ReceiptItem'] LOOP
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
REVOKE ALL ON FUNCTION almox_guard_scope() FROM PUBLIC;
