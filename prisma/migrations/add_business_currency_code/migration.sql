ALTER TABLE "business"
ADD COLUMN IF NOT EXISTS "currency_code" CHAR(3);

ALTER TABLE "business"
ADD CONSTRAINT "business_currency_code_fkey"
FOREIGN KEY ("currency_code") REFERENCES "currency" ("code")
ON DELETE NO ACTION ON UPDATE NO ACTION;
