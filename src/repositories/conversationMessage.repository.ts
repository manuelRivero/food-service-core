import type { conversation_message } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const createConversationMessage = async (
  conversationId: string,
  sender: string,
  message: string,
  isAiGenerated = false
): Promise<conversation_message> => {
  return prisma.conversation_message.create({
    data: {
      conversation_id: conversationId,
      sender,
      message,
      is_ai_generated: isAiGenerated
    }
  });
};
