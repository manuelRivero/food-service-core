import { Prisma, type conversation_message } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const createConversationMessage = async (
  conversationId: string,
  sender: string,
  message: string,
  isAiGenerated = false,
  externalMessageId?: string,
  whatsappMessageId?: string,
  metrics?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  }
): Promise<conversation_message | null> => {
  try {
    return await prisma.conversation_message.create({
      data: {
        conversation_id: conversationId,
        sender,
        message,
        is_ai_generated: isAiGenerated,
        externalMessageId,
        whatsapp_message_id: whatsappMessageId,
        ai_prompt_tokens: metrics?.promptTokens,
        ai_completion_tokens: metrics?.completionTokens,
        ai_total_tokens: metrics?.totalTokens,
        ai_estimated_cost_usd:
          metrics?.estimatedCostUsd !== undefined
            ? new Prisma.Decimal(metrics.estimatedCostUsd)
            : undefined
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return null;
    }

    throw error;
  }
};

export const findByWhatsappMessageId = async (
  whatsappMessageId: string
): Promise<conversation_message | null> => {
  return prisma.conversation_message.findUnique({
    where: { whatsapp_message_id: whatsappMessageId }
  });
};

export const getRecentMessagesByConversationId = async (
  conversationId: string,
  limit: number,
  startedAt?: Date
): Promise<conversation_message[]> => {
  return prisma.conversation_message.findMany({
    where: {
      conversation_id: conversationId,
      ...(startedAt ? { created_at: { gte: startedAt } } : {})
    },
    orderBy: { created_at: 'asc' },
    take: limit
  });
};
