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

export const findLatestConversationByCustomer = async (
  customerId: string
): Promise<conversation | null> => {
  return prisma.conversation.findFirst({
    where: {
      customer_id: customerId
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
  // 1️⃣ Buscar conversación abierta para este negocio + cliente
  const existingOpen = await prisma.conversation.findFirst({
    where: {
      business_id: businessId,
      customer_id: customerId,
      status: 'open'
      },
      orderBy: {
        last_message_at: 'desc'
      }
  });

  if (existingOpen) {
    console.info('Conversación abierta encontrada', {
      conversationId: existingOpen.id,
      customerId
    });

    return existingOpen;
  }

  // 2️⃣ Si no hay abierta, buscar la última (cerrada) para reabrir
  const latest = await prisma.conversation.findFirst({
    where: {
      business_id: businessId,
      customer_id: customerId
    },
    orderBy: {
      last_message_at: 'desc'
    }
  });

  if (latest) {
    console.info('Reabriendo conversación existente', {
      conversationId: latest.id,
      customerId
    });

    return prisma.$transaction(async (tx) => {
      const reopened = await tx.conversation.update({
        where: { id: latest.id },
        data: {
          status: 'open',
          last_message_at: new Date()
        }
      });

      await tx.conversation_state.upsert({
        where: { conversation_id: latest.id },
        update: { current_intent: null },
        create: { conversation_id: latest.id }
      });

      return reopened;
    });
  }

  // 3️⃣ Si nunca hubo conversación → crear nueva
  console.info('Creando nueva conversación', {
    businessId,
    customerId
  });

  return prisma.$transaction(async (tx) => {
    const created = await tx.conversation.create({
      data: {
        business_id: businessId,
        customer_id: customerId,
        status: 'open',
        last_message_at: new Date()
      }
    });

    await tx.conversation_state.create({
      data: {
        conversation_id: created.id
      }
    });

    return created;
  });
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
  return prisma.$transaction(async (tx) => {
    const closed = await tx.conversation.update({
      where: { id: conversationId },
      data: { status: 'closed', last_message_at: new Date() }
    });
    await tx.conversation_state.upsert({
      where: { conversation_id: conversationId },
      update: { current_intent: null },
      create: { conversation_id: conversationId }
    });
    return closed;
  });
};
