-- Unknown costs remain unknown. All previously stored amounts, including zero,
-- are preserved; this migration does not infer whether historical zero meant free
-- or unreported. A responsible user can review those records later.
ALTER TABLE "Product"
  ALTER COLUMN "unitCost" DROP NOT NULL,
  ALTER COLUMN "unitCost" DROP DEFAULT;
