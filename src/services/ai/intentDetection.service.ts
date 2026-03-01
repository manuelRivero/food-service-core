// src/services/intent/detectionService.ts

import OpenAI from 'openai';
import { prisma } from '../../lib/prisma';
import { ConversationIntent } from '../../types/conversationIntent';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface IntentDetectionResult {
  intent: ConversationIntent;
  confidence: number;
  detectedProductName: string | null;
  quantity: number | null;
  candidates: Array<{
    intent: ConversationIntent;
    confidence: number;
  }>;
  raw: string; // respuesta cruda del LLM para debug
}

export const detectIntentWithConfidence = async (
  message: string,
  context: {
    conversationMode: string;
    lastReferencedProductId: string | null;
    candidateProductIds: string[] | null;
    recentMessages: string[];
  }
): Promise<IntentDetectionResult> => {
  
  const prompt = buildDetectionPrompt(message, context);
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are an intent classifier for a restaurant WhatsApp bot.
Analyze the user's message and return structured intent information.

Rules:
- Detect the primary intent from the available list
- Extract any product name mentioned
- Extract quantity if specified (default to null if not)
- Provide confidence score (0-1)
- If uncertain, provide top 2-3 candidates

Available intents:
- ORDER_FOOD: wants to order/add something
- REMOVE_ITEM: wants to remove/delete something from order
- MODIFY_QUANTITY: wants to change quantity
- PRODUCT_QUERY: searching for a product
- PRODUCT_ATTRIBUTE_QUESTION: asking about product details
- VIEW_MENU: wants to see menu
- VIEW_ORDER: wants to see current order
- SMALL_TALK: greeting or casual
- ASK_QUESTION: general question
- UNKNOWN: cannot classify`
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
    
    // Aplicar context override: PRODUCT_FOCUS domina PRODUCT_QUERY
    let finalIntent = normalizeIntent(parsed.intent);
    if (
      context.conversationMode === 'PRODUCT_FOCUS' &&
      finalIntent === ConversationIntent.PRODUCT_QUERY &&
      parsed.detectedProductName
    ) {
      finalIntent = ConversationIntent.PRODUCT_ATTRIBUTE_QUESTION;
    }
    
    return {
      intent: finalIntent,
      confidence: parsed.confidence || 0,
      detectedProductName: parsed.detectedProductName || null,
      quantity: parsed.quantity || null,
      candidates: parsed.candidates || [],
      raw: content
    };
  } catch (error) {
    return {
      intent: ConversationIntent.UNKNOWN,
      confidence: 0,
      detectedProductName: null,
      quantity: null,
      candidates: [],
      raw: content
    };
  }
};

const buildDetectionPrompt = (
  message: string,
  context: {
    conversationMode: string;
    lastReferencedProductId: string | null;
    candidateProductIds: string[] | null;
    recentMessages: string[];
  }
): string => {
  return `
USER MESSAGE: "${message}"

CONTEXT:
- Conversation mode: ${context.conversationMode}
- Last referenced product: ${context.lastReferencedProductId || 'none'}
- Candidate products: ${context.candidateProductIds?.length || 0} items
- Recent messages: ${context.recentMessages.slice(-3).join(' | ')}

Respond in JSON:
{
  "intent": "INTENT_NAME",
  "confidence": 0.0-1.0,
  "detectedProductName": "product name or null",
  "quantity": number or null,
  "candidates": [
    {"intent": "INTENT_NAME", "confidence": 0.0-1.0}
  ]
}`;
};

const normalizeIntent = (raw: string): ConversationIntent => {
  const normalized = raw.trim().toUpperCase();
  if (Object.values(ConversationIntent).includes(normalized as ConversationIntent)) {
    return normalized as ConversationIntent;
  }
  return ConversationIntent.UNKNOWN;
};