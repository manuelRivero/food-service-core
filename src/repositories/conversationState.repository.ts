import type { conversation_state, Prisma } from '@prisma/client';
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

export const updateConversationState = async (
  conversationId: string,
  data: Prisma.conversation_stateUpdateInput
): Promise<conversation_state> => {
  return prisma.conversation_state.update({
    where: { conversation_id: conversationId },
    data
  });
};
