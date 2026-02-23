import OpenAI from 'openai';
import type { business as Business } from '@prisma/client';
import type { OpenAI as OpenAITypes } from 'openai';
import { prisma } from '../../lib/prisma';
import { incrementUsage, resetIfNeeded } from './aiUsage.service';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const getDefaultTokenLimitByPlan = (plan: string): number => {
  switch (plan) {
    case 'pro':
      return 500000;
    case 'enterprise':
      return 2000000;
    case 'basic':
    default:
      return 100000;
  }
};

export const generateAIResponse = async (
  business: Business,
  messages: OpenAITypes.Chat.ChatCompletionMessageParam[]
): Promise<{
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
}> => {
  if (business.ai_blocked) {
    return {
      content:
        '🚫 Tu cuenta está bloqueada por superar el límite mensual de IA. Actualiza tu plan para continuar.',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0
      }
    };
  }

  const updatedBusiness = await resetIfNeeded(business);

  const plan = updatedBusiness.ai_plan ?? 'basic';
  const effectiveLimit =
    updatedBusiness.ai_monthly_token_limit ?? getDefaultTokenLimitByPlan(plan);

  if (updatedBusiness.ai_monthly_tokens_used >= effectiveLimit) {
    await prisma.business.update({
      where: { id: updatedBusiness.id },
      data: { ai_blocked: true }
    });

    return {
      content:
        '⚡ Tu plan mensual de IA se agotó. Actualiza tu plan para seguir respondiendo automáticamente.',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0
      }
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages
    });

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = response.usage?.total_tokens ?? 0;

    const promptCost = (promptTokens / 1000) * 0.00015;
    const completionCost = (completionTokens / 1000) * 0.0006;
    const estimatedCostUsd = promptCost + completionCost;

    await incrementUsage(updatedBusiness.id, totalTokens);

    return {
      content: response.choices[0]?.message?.content ?? '',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    throw new Error(`Error al generar respuesta de OpenAI: ${message}`);
  }
};

export const generateProductAwareResponse = async (params: {
  product: {
    name: string;
    description?: string | null;
    ingredients?: string | null;
    serves_people?: number | null;
    is_available: boolean;
    price?: {
      amount: unknown;
      currency_code: string;
    } | null;
  };
  userQuestion: string;
}): Promise<string> => {
  const { product, userQuestion } = params;

  console.log('---- LLM PRODUCT CALL ----');
  console.log('Product name:', product.name);
  console.log('User question sent to LLM:', userQuestion);
  console.log('---------------------------');

  const priceText =
    product.price?.amount != null
      ? `${String(product.price.amount)} ${product.price.currency_code}`
      : 'N/A';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'You answer questions about a restaurant product. Use ONLY the provided product data. Do NOT invent price, availability, or characteristics. If information is not available, say you do not have that information. Be concise and natural.'
      },
      {
        role: 'user',
        content: `PRODUCT DATA:
Name: ${product.name}
Available: ${product.is_available ? 'yes' : 'no'}
Price: ${priceText}
Serves people: ${product.serves_people ?? 'N/A'}
Description: ${product.description ?? 'N/A'}
Ingredients: ${product.ingredients ?? 'N/A'}

USER QUESTION:
${userQuestion}`
      }
    ]
  });

  const content = response.choices[0]?.message?.content ?? '';
  console.log('LLM response:', content);
  return content;
};

export const extractOrderData = async (
  message: string
): Promise<{ quantity: number | null; confidence: number }> => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a data extraction engine.
Extract structured order data from the user's message.

Return STRICT JSON:

{
  "quantity": number | null,
  "confidence": number
}

Rules:
- If user expresses ordering intent but no explicit quantity, assume quantity = 1
- Recognize numbers written as digits or words in Spanish.
- Recognize informal expressions.
- If no quantity can be inferred, return quantity = null.
- Confidence between 0 and 1.
Return ONLY JSON.

Examples:

Input: "Te pido 3"
Output: {"quantity":3,"confidence":0.95}

Input: "Dame uno"
Output: {"quantity":1,"confidence":0.9}

Input: "Agregame dos mas"
Output: {"quantity":2,"confidence":0.95}

Input: "Lo quiero"
Output: {"quantity":1,"confidence":0.8}

Input: "Tal vez luego"
Output: {"quantity":null,"confidence":0.2}`
      },
      {
        role: 'user',
        content: message
      }
    ]
  });

  const content = response.choices[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(content) as {
      quantity?: number | null;
      confidence?: number;
    };
    const quantity =
      typeof parsed.quantity === 'number' || parsed.quantity === null
        ? parsed.quantity
        : null;
    const confidence =
      typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    return { quantity, confidence };
  } catch (error) {
    return { quantity: null, confidence: 0 };
  }
};

export const generateOrderExtraction = async (params: {
  userMessage: string;
}): Promise<{ quantity: number }> => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Extrae la cantidad de productos que el usuario desea pedir.
Si no se menciona cantidad explícita, devolver 1.
Si está en palabras ("dos", "tres", "un", "una"), convertir a número.
Si es ambiguo, devolver 1.

Responde SOLO en JSON:
{
"quantity": number
}`
      },
      {
        role: 'user',
        content: params.userMessage
      }
    ]
  });

  const content = response.choices[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(content) as { quantity?: number };
    const quantity = typeof parsed.quantity === 'number' ? parsed.quantity : 1;
    return { quantity };
  } catch (error) {
    return { quantity: 1 };
  }
};
