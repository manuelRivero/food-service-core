import OpenAI from 'openai';
import type { OpenAI as OpenAITypes } from 'openai';
import { ConversationIntent } from '../types/conversationIntent';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const INTENT_CLASSIFIER_PROMPT = `
You are an intent classification engine for a WhatsApp food ordering SaaS system.

Your job is to analyze a user's message and return structured JSON.

The user may express multiple intents in one message.

You must return ONLY valid JSON. No explanations. No extra text.

Available intents:

SMALL_TALK
VIEW_MENU
VIEW_ORDER
ORDER_FOOD
TRACK_ORDER
PAYMENT_REQUEST
SUPPORT
BUSINESS_HOURS
BUSINESS_LOCATION
DELIVERY_INFO
PAYMENT_METHODS
PRODUCT_QUERY
GENERAL_QUESTION
UNKNOWN

Rules:

1. A message can contain multiple intents.
2. If the message contains ONLY greeting words (examples: "hola", "buenas", "buenos dias", "hey", "hello") and no product, order, or business-related request → SMALL_TALK.
3. If greeting is combined with another intent → ignore greeting and classify by main intent.
4. If asking about opening/closing times → BUSINESS_HOURS.
5. If asking where the business is located → BUSINESS_LOCATION.
6. If asking about delivery areas, shipping cost, or delivery time → DELIVERY_INFO.
7. If asking about payment options → PAYMENT_METHODS.
8. If asking for menu or categories → VIEW_MENU.
9. If asking about cart or current order → VIEW_ORDER.
10. If user wants to order → ORDER_FOOD.
11. If asking about order status → TRACK_ORDER.
12. If reporting problem or requesting human help → SUPPORT.
13. Any question about a specific product (availability, ingredients, price, variants, preparation, dietary questions) → PRODUCT_QUERY.
14. If general informational question not covered above → GENERAL_QUESTION.
15. If completely unclear → UNKNOWN.

Entity extraction rules:

- If a specific product is mentioned, extract it as:
  "product_name": "<normalized lower case name>"
- If no product is mentioned, set product_name to null.

Output format:

{
  "intents": ["INTENT_1", "INTENT_2"],
  "entities": {
    "product_name": string | null
  },
  "confidence": number (0 to 1)
}

Return only JSON.
`;

const normalizeIntent = (value: string): ConversationIntent => {
  const trimmed = value.trim().toUpperCase();

  switch (trimmed) {
    case ConversationIntent.SMALL_TALK:
    case ConversationIntent.VIEW_MENU:
    case ConversationIntent.VIEW_ORDER:
    case ConversationIntent.ASK_QUESTION:
    case ConversationIntent.ORDER_FOOD:
    case ConversationIntent.TRACK_ORDER:
    case ConversationIntent.PAYMENT_REQUEST:
    case ConversationIntent.SUPPORT:
    case ConversationIntent.BUSINESS_HOURS:
    case ConversationIntent.BUSINESS_LOCATION:
    case ConversationIntent.DELIVERY_INFO:
    case ConversationIntent.PAYMENT_METHODS:
    case ConversationIntent.PRODUCT_QUERY:
    case ConversationIntent.GENERAL_QUESTION:
    case ConversationIntent.UNKNOWN:
      return trimmed as ConversationIntent;
    default:
      return ConversationIntent.UNKNOWN;
  }
};

export const detectIntent = async (
  messages: OpenAITypes.Chat.ChatCompletionMessageParam[]
): Promise<ConversationIntent> => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 150,
    messages: [
      {
        role: 'system',
        content: INTENT_CLASSIFIER_PROMPT
      },
      ...messages
    ]
  });

  const content = response.choices[0]?.message?.content ?? '';
  console.log('Intent classifier raw response:', content);
  try {
    const parsed = JSON.parse(content) as {
      intents?: string[];
      entities?: { product_name?: string | null };
      confidence?: number;
    };
    const intents = Array.isArray(parsed.intents) ? parsed.intents : [];
    const normalized = intents.map((intent) => normalizeIntent(intent));
    const nonGreeting = normalized.filter((intent) => intent !== ConversationIntent.SMALL_TALK);
    if (nonGreeting.length > 0) {
      return nonGreeting[0];
    }
    if (normalized.length > 0) {
      return normalized[0];
    }
    console.log('Intent classifier parsed JSON has no intents:', parsed);
    return ConversationIntent.UNKNOWN;
  } catch (error) {
    console.error('Intent classifier JSON parse error:', error);
    const trimmed = content.trim().toUpperCase();
    const isSingleKeyword = /^[A-Z_]+$/.test(trimmed);
    if (isSingleKeyword) {
      return normalizeIntent(trimmed);
    }
    console.warn('Intent classifier fallback to UNKNOWN for content:', content);
    return ConversationIntent.UNKNOWN;
  }
};
