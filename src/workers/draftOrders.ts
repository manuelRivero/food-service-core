import { sendListResponseNoContext, sendResponseNoContext } from '../controllers/webhook/sender';
import { prisma } from '../lib/prisma';
import { workerTextMessages } from './textMessages';
import { buildListMessageFromButtons } from '../whatsappBuilders';

const REMINDER_MINUTES = 1;
const IDLE_REMINDER_MINUTES = Number(process.env.CONVERSATION_IDLE_REMINDER_MINUTES ?? 1);
const IDLE_EXPIRE_MINUTES = Number(process.env.CONVERSATION_IDLE_EXPIRE_MINUTES ?? 2);

export const processDraftOrderTimeouts = async () => {

    const now = new Date();

    const orders = await prisma.draft_order.findMany({
        where: {
            status: 'active',
            expires_at: { not: null }
        }
    });

    for (const order of orders) {

        if (!order.expires_at) continue;

        const remainingMs = order.expires_at.getTime() - now.getTime();
        const remainingMinutes = remainingMs / 60000;

        const business = await prisma.business.findUnique({
            where: { id: order.business_id! }
        });

        if (!business) continue;

        /**
         * Reminder
         */
        if (
            remainingMinutes <= REMINDER_MINUTES &&
            remainingMinutes > 0 &&
            !order.reminder_sent_at
        ) {
            console.log('Sending reminder for draft order', order.id);
            const listMessage = buildListMessageFromButtons(
                workerTextMessages.draftOrderReminderListBody(REMINDER_MINUTES),
                [
                    {
                        title: 'Seguir comprando',
                        payload: 'VIEW_MENU',
                        description: 'Explorar más platos',
                        sectionTitle: 'Opciones'
                    },
                    {
                        title: 'Finalizar pedido',
                        payload: 'CHECKOUT',
                        description: 'Ir al checkout',
                        sectionTitle: 'Opciones'
                    },
                    {
                        title: 'Modificar pedido',
                        payload: 'VIEW_CART_FOR_EDITION',
                        description: 'Editar items del pedido',
                        sectionTitle: 'Opciones'
                    }
                ],
                'Ver opciones',
                '🤖\n\n*Recordatorio*',
                'Seleccioná una opción para continuar'
            );

            await sendListResponseNoContext(
                business.whatsapp_phone_id!,
                order.customer_phone,
                listMessage
            );

            await prisma.draft_order.update({
                where: { id: order.id },
                data: { reminder_sent_at: new Date() }
            });

            continue;
        }

        /**
         * Expiration
         */
        if (remainingMinutes <= 0) {

            await prisma.draft_order_item.deleteMany({
                where: { draft_order_id: order.id }
            });

            await prisma.draft_order.delete({
                where: { id: order.id }
            });

            const expiredListMessage = buildListMessageFromButtons(
                workerTextMessages.draftOrderExpiredListBody,
                [
                    {
                        title: 'Ver menú',
                        payload: 'VIEW_MENU',
                        description: 'Explorar platos disponibles',
                        sectionTitle: 'Opciones'
                    },
                    {
                        title: 'Hacer una consulta',
                        payload: 'ASK_QUESTION',
                        description: 'Resolver una duda',
                        sectionTitle: 'Opciones'
                    }
                ],
                'Ver opciones',
                '🤖\n\n*Pedido cancelado*',
                'Seleccioná una opción para continuar'
            );

            await sendListResponseNoContext(
                business.whatsapp_phone_id!,
                order.customer_phone,
                expiredListMessage
            );

            /**
             * limpiar estado de conversación
             */
            const conversation = await prisma.conversation.findFirst({
                where: {
                    business_id: order.business_id!,
                    customer: {
                        phone_number: order.customer_phone
                    },
                    status: 'open'
                }
            });

            if (conversation) {
                await resetConversationState(conversation.id);
            }

        }

    }

    /**
     * Conversaciones inactivas (sin importar si hay pedido)
     */
    const reminderThreshold = new Date(now.getTime() - IDLE_REMINDER_MINUTES * 60000);
    const expireThreshold = new Date(now.getTime() - IDLE_EXPIRE_MINUTES * 60000);

    const conversationsToRemind = await prisma.conversation.findMany({
        where: {
            status: 'open',
            last_message_at: { lte: reminderThreshold },
            idle_reminder_sent_at: null,
            idle_closed_at: null
        },
        include: {
            business: true,
            customer: true
        }
    });

    for (const conversation of conversationsToRemind) {
        if (!conversation.business?.whatsapp_phone_id || !conversation.customer?.phone_number) continue;
        console.log('[IdleReminder] Sending to', {
            businessPhoneId: conversation.business.whatsapp_phone_id,
            to: conversation.customer.phone_number,
            conversationId: conversation.id
        });
        await sendResponseNoContext(
            conversation.business.whatsapp_phone_id,
            conversation.customer.phone_number,
            `🤖\n\n${workerTextMessages.conversationIdleReminder(IDLE_EXPIRE_MINUTES)}`
        );
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { idle_reminder_sent_at: now }
        });
    }

    const conversationsToClose = await prisma.conversation.findMany({
        where: {
            status: 'open',
            last_message_at: { lte: expireThreshold },
            idle_closed_at: null
        },
        include: {
            business: true,
            customer: true
        }
    });

    for (const conversation of conversationsToClose) {
        if (!conversation.business?.whatsapp_phone_id || !conversation.customer?.phone_number) continue;
        await sendResponseNoContext(
            conversation.business.whatsapp_phone_id,
            conversation.customer.phone_number,
            `🤖\n\n${workerTextMessages.conversationIdleClosed}`
        );
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                status: 'closed',
                idle_closed_at: now,
                lastReferencedProductId: null
            }
        });
        await resetConversationState(conversation.id);
    }

};

const resetConversationState = async (conversationId: string) => {
    await prisma.conversation_state.upsert({
        where: { conversation_id: conversationId },
        update: {
            mode: 'GLOBAL',
            metadata: {}
        },
        create: {
            conversation_id: conversationId,
            mode: 'GLOBAL',
            metadata: {}
        }
    });
};