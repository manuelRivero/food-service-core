import { Prisma, type conversation } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const findOpenConversationByCustomer = async (
  customerId: string
): Promise<conversation | null> => {
  return prisma.conversation.findFirst({
    where: {
      customer_id: customerId,
      status: 'open'
    },
    orderBy: {
      last_message_at: 'desc'
    }
  });
};

export const createConversation = async (
  businessId: string,
  customerId: string
): Promise<conversation> => {
  return prisma.conversation.create({
    data: {
      business_id: businessId,
      customer_id: customerId,
      channel: 'whatsapp',
      status: 'open'
    }
  });
};

export const createOrGetOpenConversation = async (
  businessId: string,
  customerId: string
): Promise<conversation> => {
  try {
    return await createConversation(businessId, customerId);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      console.warn('P2002 al crear conversación, buscando abierta existente', {
        businessId,
        customerId
      });
      const existing = await findOpenConversationByCustomer(customerId);
      if (existing) {
        console.info('Conversación abierta encontrada', {
          conversationId: existing.id,
          customerId
        });
        return existing;
      }
    }

    throw error;
  }
};

export const updateConversationLastMessageAt = async (
  conversationId: string
): Promise<conversation> => {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { last_message_at: new Date() }
  });
};

export const closeConversation = async (
  conversationId: string
): Promise<conversation> => {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'closed', last_message_at: new Date() }
  });
};
