ALTER TABLE "conversation_message"
ADD COLUMN IF NOT EXISTS "ai_prompt_tokens" INT,
ADD COLUMN IF NOT EXISTS "ai_completion_tokens" INT,
ADD COLUMN IF NOT EXISTS "ai_total_tokens" INT,
ADD COLUMN IF NOT EXISTS "ai_estimated_cost_usd" DECIMAL(10, 6);
