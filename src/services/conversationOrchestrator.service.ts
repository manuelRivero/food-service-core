import OpenAI from 'openai';
import type { OpenAI as OpenAITypes } from 'openai';
import { ConversationIntent } from '../types/conversationIntent';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const INTENT_SYSTEM_PROMPT =
  "Classify the user's intent strictly as one of:\n" +
  "SMALL_TALK,\n" +
  "VIEW_MENU,\n" +
  "VIEW_ORDER,\n" +
  "ASK_QUESTION,\n" +
  "ORDER_FOOD,\n" +
  "TRACK_ORDER,\n" +
  "PAYMENT_REQUEST,\n" +
  "SUPPORT,\n" +
  "UNKNOWN.\n\n" +
  "Food service context (English + Spanish examples):\n" +
  "- VIEW_MENU: user wants to see menu, food list, prices, categories. (\"menu\", \"ver menu\", \"categorias\")\n" +
  "- VIEW_ORDER: user wants to see current order, cart, or order summary. (\"mi pedido\", \"ver pedido\")\n" +
  "- ASK_QUESTION: user says they have a question or need information. (\"tengo una duda\", \"consulta\", \"informacion\")\n" +
  "- ORDER_FOOD: user wants to order something. (\"quiero pedir\", \"ordenar\")\n" +
  "- TRACK_ORDER: user asks about order status. (\"donde esta mi pedido\", \"estado\")\n" +
  "- PAYMENT_REQUEST: user asks how to pay or requests payment link. (\"como pago\", \"link de pago\")\n" +
  "- SUPPORT: complaints or human assistance. (\"soporte\", \"ayuda\", \"reclamo\", \"problema\", \"duda\")\n" +
  "- SMALL_TALK: greetings or casual talk. (\"hola\", \"buenas\")\n" +
  "- UNKNOWN: unclear intent.\n\n" +
  'Return ONLY the intent keyword.';

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
    max_tokens: 10,
    messages: [
      {
        role: 'system',
        content: INTENT_SYSTEM_PROMPT
      },
      ...messages
    ]
  });

  const content = response.choices[0]?.message?.content ?? '';
  return normalizeIntent(content);
};
