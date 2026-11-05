-- Defense in depth: backend validation is also represented in persistent constraints.
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_limits_check"
 CHECK ("minStock" >= 0 AND ("maxStock" IS NULL OR "maxStock" >= "minStock") AND "unitCost" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_check" CHECK (quantity > 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_route_check" CHECK (
 (type = 'ENTRY' AND "sourceId" IS NULL AND "destinationId" IS NOT NULL) OR
 (type = 'EXIT' AND "sourceId" IS NOT NULL AND "destinationId" IS NULL) OR
 (type = 'TRANSFER' AND "sourceId" IS NOT NULL AND "destinationId" IS NOT NULL AND "sourceId" <> "destinationId") OR
 (type = 'ADJUSTMENT' AND (("sourceId" IS NULL AND "destinationId" IS NOT NULL) OR ("sourceId" IS NOT NULL AND "destinationId" IS NULL)))
);
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_count_check" CHECK ("countedQuantity" >= 0 AND difference = "countedQuantity" - "expectedQuantity");
ALTER TABLE "Location" ADD CONSTRAINT "Location_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> id);
-- Supports case-insensitive substring search through Prisma contains / mode: insensitive.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Product_name_trgm_idx" ON "Product" USING gin (name gin_trgm_ops);
CREATE INDEX "Product_code_trgm_idx" ON "Product" USING gin ("internalCode" gin_trgm_ops);
CREATE INDEX "Product_sku_trgm_idx" ON "Product" USING gin (sku gin_trgm_ops);
CREATE INDEX "Location_code_trgm_idx" ON "Location" USING gin (code gin_trgm_ops);
CREATE INDEX "Location_name_trgm_idx" ON "Location" USING gin (name gin_trgm_ops);
CREATE INDEX "Supplier_name_trgm_idx" ON "Supplier" USING gin ("legalName" gin_trgm_ops);
