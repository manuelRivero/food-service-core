import type { conversation_state } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const findOrCreateConversationState = async (
  conversationId: string
): Promise<conversation_state> => {
  return prisma.conversation_state.upsert({
    where: { conversation_id: conversationId },
    update: {},
    create: { conversation_id: conversationId }
  });
};
