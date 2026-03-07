import { sendResponseNoContext } from '../controllers/webhook/sender';
import { prisma } from '../lib/prisma';

const REMINDER_MINUTES = 1;

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
            await sendResponseNoContext(
                business.whatsapp_phone_id!,
                order.customer_phone,
                `🛒 Tienes un pedido en curso.
                \nSi no finalizas tu compra en ${REMINDER_MINUTES} minutos, tu pedido será cancelado automáticamente.`);

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

            await sendResponseNoContext(
                business.whatsapp_phone_id!,
                order.customer_phone, 
                `⏰ Tu pedido fue cancelado por inactividad.
                Puedes iniciar uno nuevo cuando quieras.`
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

                await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: {
                        lastReferencedProductId: null
                    }
                });

                await prisma.conversation_state.update({
                    where: { conversation_id: conversation.id },
                    data: {
                        mode: 'GLOBAL',
                        metadata: undefined
                    }
                });

            }

        }

    }

};