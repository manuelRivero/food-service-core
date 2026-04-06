// services/checkoutService.ts

import { customer as CustomerType, business as BusinessType, conversation as ConversationType } from '@prisma/client';
import { OrderPaymentStatus, OrderStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createConversationMessage, createOrGetOpenConversation, findBusinessByPhoneNumberId, findOrCreateConversationState, findOrCreateCustomer, updateConversationLastMessageAt } from '../repositories';
import { WhatsAppWebhookPayload } from '../controllers/webhook/types';


interface CheckoutResult {
    message: string | null;
    errorMessage?: string;
}

export const buildCheckoutMessage = async (
    business: BusinessType,
    conversation: ConversationType,
    customer: CustomerType
): Promise<CheckoutResult> => {

    if (!business) {
        return { message: null, errorMessage: 'No se encontró el negocio' };
    }

    const cart = await prisma.orders.findFirst({
        where: { conversation_id: conversation.id },
        include: { order_item: { include: { menu_item: true } } }
    });

    if (!cart || cart.order_item.length === 0) {
        const errorText = '🤖\n\n*Tu pedido está vacío 🛒*\n\nPodés explorar el menú para empezar tu pedido.';
        await createConversationMessage(conversation.id, 'ai', errorText, false);
        await updateConversationLastMessageAt(conversation.id);
        return { message: null, errorMessage: errorText };
    }

    const order = await prisma.orders.create({
        data: {
            business_id: business.id,
            customer_id: customer.id,
            conversation_id: conversation.id,
            status: OrderStatus.placed,
            payment_status: OrderPaymentStatus.deferred,
            total_amount: cart.order_item.reduce((sum, item) => sum + (item.quantity * item.unit_price.toNumber()), 0),
            order_item: {
                create: cart.order_item.map(item => ({
                    menu_item_id: item.menu_item_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price
                }))
            },
            currency_code: business.currency_code ?? 'ARS',
        }
    });

    await prisma.order_item.deleteMany({ where: { order_id: order.id } });
    await prisma.orders.delete({ where: { id: order.id } });

    const messageText = `✅ *Pedido confirmado*\n\n` +
        `Número: #${order.id}\n` +
        `Total: $${order.total_amount?.toNumber() ?? 0}\n` +
        `Estado: ${order.status}\n\n` +
        `En breve recibirás el link de pago. ¡Gracias!`;

    await createConversationMessage(conversation.id, 'ai', messageText, false);
    await updateConversationLastMessageAt(conversation.id);

    return { message: messageText };
};

export const handleCheckoutFromWebhook = async (
    payload: WhatsAppWebhookPayload
): Promise<string | null> => {

    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const from = message?.from;
    const phoneNumberId = value?.metadata?.phone_number_id;

    if (!phoneNumberId || !from) return null;

    const business = await findBusinessByPhoneNumberId(phoneNumberId);
    if (!business) return null;

    const customer = await findOrCreateCustomer(business.id, from);
    const conversation = await createOrGetOpenConversation(business.id, customer.id);
    await findOrCreateConversationState(conversation.id);

    const result = await buildCheckoutMessage(business, conversation, customer);

    if (result.errorMessage) return result.errorMessage;
    return result.message;
};