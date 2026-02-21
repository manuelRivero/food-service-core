ALTER TABLE "conversation_message"
ADD COLUMN IF NOT EXISTS "externalMessageId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_message_externalMessageId_key"
ON "conversation_message"("externalMessageId");
