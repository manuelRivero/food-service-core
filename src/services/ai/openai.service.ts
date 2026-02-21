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
