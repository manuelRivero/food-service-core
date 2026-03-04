// src/services/intent/detectionService.ts

import OpenAI from 'openai';
import { prisma } from '../../lib/prisma';
import { ConversationIntent } from '../../types/conversationIntent';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface DetectionContext {
  conversationMode: string;
  lastReferencedProductId: string | null;
  candidateProductIds: string[] | null;
  recentMessages: string[];
  lastReferencedProductName?: string | null;
}

export interface IntentDetectionResult {
  intent: ConversationIntent;
  confidence: number;
  detectedProductName: string | null;
  quantity: number | null;
  candidates: Array<{
    intent: ConversationIntent;
    confidence: number;
  }>;
  raw: string;
}

export const detectIntentWithConfidence = async (
  message: string,
  context: DetectionContext
): Promise<IntentDetectionResult> => {

  const prompt = buildDetectionPrompt(message, context);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are an intent classifier for a restaurant WhatsApp bot.
Analyze the user's message and return structured intent information.

Available intents:
- ORDER_FOOD: wants to order/add something (e.g., "quiero una hamburguesa", "dame 2 pizzas")
- REMOVE_ITEM: wants to remove/delete something from order (e.g., "sacá la pizza", "quitame la coca")
- MODIFY_QUANTITY: wants to change quantity (e.g., "cambiá a 3", "son 4 en total")
- PRODUCT_QUERY: searching for a product (e.g., "tienen ceviche?", "hay postres")
- PRODUCT_ATTRIBUTE_QUESTION: asking about product details (e.g., "cuánto cuesta?", "es picante?")
- VIEW_MENU: wants to see menu (e.g., "ver menú", "qué tienen?")
- VIEW_CART: wants to see current cart (e.g., "cuánto llevo?", "ver mi pedido")
- VIEW_CART_FOR_EDITION: wants to see current cart for edition (e.g., "modificar mi pedido")
- SMALL_TALK: greeting or casual (e.g., "hola", "buenas")
- ASK_QUESTION: general question (e.g., "dónde están?", "cuál es el horario?")
- UNKNOWN: cannot classify

Rules:
- Extract product name when mentioned
- Extract quantity when specified (number or words like "dos", "tres")
- Provide confidence 0-1
- If uncertain, provide top 2-3 candidates`
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const content = response.choices[0]?.message?.content || '{}';

    try {
      const parsed = JSON.parse(content);

      // Normalizar intent
      let finalIntent = normalizeIntent(parsed.intent);

      // Context override: PRODUCT_FOCUS domina PRODUCT_QUERY
      if (context.conversationMode === 'PRODUCT_FOCUS') {

        const lower = message.toLowerCase().trim();
      
        const isLikelyAttribute =
          lower.startsWith('lleva') ||
          lower.startsWith('tiene') ||
          lower.startsWith('es ') ||
          lower.startsWith('trae') ||
          (lower.endsWith('?') && lower.split(' ').length <= 4);
      
        const explicitlySearchingNewDish =
          lower.includes('tienen') ||
          lower.includes('hay') ||
          lower.includes('algo con') ||
          lower.includes('platos con');
      
        if (
          finalIntent === ConversationIntent.PRODUCT_QUERY &&
          isLikelyAttribute &&
          !explicitlySearchingNewDish
        ) {
          console.log('[Detection] Forced ATTRIBUTE in PRODUCT_FOCUS');
          finalIntent = ConversationIntent.PRODUCT_ATTRIBUTE_QUESTION;
        }
      }

      // Extraer cantidad de texto si no viene en JSON
      const quantity = parsed.quantity ?? extractQuantityFromText(message);

      return {
        intent: finalIntent,
        confidence: parsed.confidence || 0,
        detectedProductName: parsed.detectedProductName || null,
        quantity,
        candidates: parsed.candidates || [],
        raw: content
      };

    } catch (parseError) {
      console.error('[Detection] JSON parse error:', parseError);
      return {
        intent: ConversationIntent.UNKNOWN,
        confidence: 0,
        detectedProductName: null,
        quantity: null,
        candidates: [],
        raw: content
      };
    }

  } catch (error) {
    console.error('[Detection] OpenAI error:', error);
    return {
      intent: ConversationIntent.UNKNOWN,
      confidence: 0,
      detectedProductName: null,
      quantity: null,
      candidates: [],
      raw: String(error)
    };
  }
};

const buildDetectionPrompt = (
  message: string,
  context: DetectionContext
): string => {
  return `
USER MESSAGE: "${message}"

CONVERSATION CONTEXT:
- Mode: ${context.conversationMode}
- Last referenced product: ${context.lastReferencedProductId || 'none'}
- Candidate products available: ${context.candidateProductIds?.length || 0}
- Recent conversation: ${context.recentMessages.slice(-3).join(' | ')}

Respond with JSON:
{
  "intent": "INTENT_NAME",
  "confidence": 0.0-1.0,
  "detectedProductName": "product name mentioned or null",
  "quantity": number or null,
  "candidates": [
    {"intent": "INTENT_NAME", "confidence": 0.0-1.0}
  ]
}`;
};

const normalizeIntent = (raw: string): ConversationIntent => {
  const normalized = raw.trim().toUpperCase();

  const validIntents = Object.values(ConversationIntent);
  if (validIntents.includes(normalized as ConversationIntent)) {
    return normalized as ConversationIntent;
  }

  return ConversationIntent.UNKNOWN;
};

const extractQuantityFromText = (text: string): number | null => {
  // Números explícitos
  const numberMatch = text.match(/\b(\d+)\b/);
  if (numberMatch) {
    const num = parseInt(numberMatch[1], 10);
    if (num > 0 && num < 100) return num;
  }

  // Palabras en español
  const wordMap: Record<string, number> = {
    'uno': 1, 'una': 1, 'un': 1,
    'dos': 2,
    'tres': 3,
    'cuatro': 4,
    'cinco': 5,
    'seis': 6,
    'siete': 7,
    'ocho': 8,
    'nueve': 9,
    'diez': 10
  };

  const lowerText = text.toLowerCase();
  for (const [word, num] of Object.entries(wordMap)) {
    if (lowerText.includes(word)) return num;
  }

  return null;
};