ALTER TABLE "conversation_message"
ADD COLUMN IF NOT EXISTS "whatsapp_message_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_message_whatsapp_message_id_key"
ON "conversation_message"("whatsapp_message_id");
