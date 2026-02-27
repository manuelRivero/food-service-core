// services/cartService.ts

import { business, conversation, customer } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createConversationMessage, findBusinessByPhoneNumberId, findOrCreateConversationState, updateConversationLastMessageAt } from "../repositories";
import { findOrCreateCustomer } from "../repositories/customer.repository";
import { createOrGetOpenConversation } from "../repositories/conversation.repository";
import { WhatsAppWebhookPayload } from "../controllers/webhook/types";

export const buildAddItemMessage = async (
    business: business,
    conversation: conversation,
    menuItemId: string,
    customer: customer
  ): Promise<string | null> => {
    
    let cart = await prisma.orders.findFirst({
      where: { conversation_id: conversation.id }
    });
  
    if (!cart) {
      cart = await prisma.orders.create({
        data: { business_id: business.id, customer_id: customer.id, conversation_id: conversation.id, currency_code: business.currency_code ?? 'ARS' }
      });
    }
  
    const item = await prisma.menu_item.findFirst({
        where: { id: menuItemId, business_id: business.id, is_available: true },
        include: {
          menu_item_price: {
            where: {
              is_active: true,
              valid_from: { lte: new Date() },
              OR: [{ valid_to: null }, { valid_to: { gte: new Date() } }]
            },
            orderBy: { valid_from: 'desc' },
            take: 1
          }
        }
      });
  
    if (!item) {
      const errorText = 'Producto no encontrado o no disponible.';
      await createConversationMessage(conversation.id, 'ai', errorText, false);
      await updateConversationLastMessageAt(conversation.id);
      return errorText;
    }

    
    
    const existingItem = await prisma.order_item.findFirst({
      where: { order_id: cart.id, menu_item_id: menuItemId }
    });
  
    if (existingItem) {
      await prisma.order_item.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + 1 }
      });
    } else {
      await prisma.order_item.create({
        data: {
          order_id: cart.id,
          menu_item_id: menuItemId,
          quantity: 1,
          unit_price: item.menu_item_price[0]?.amount.toNumber() || 0,

        }
      });
    }
  
    const itemCount = await prisma.order_item.count({ where: { order_id: cart.id } });
    const total = await prisma.order_item.aggregate({
      where: { order_id: cart.id },
      _sum: { unit_price: true }
    });
  
    const messageText = `🛒 *${item.name}* agregado\n\n` +
      `Items en carrito: ${itemCount}\n` +
      `Total: $${total._sum.unit_price || 0}\n\n` +
      `¿Seguís comprando o querés *finalizar*?`;
  
    await createConversationMessage(conversation.id, 'ai', messageText, false);
    await updateConversationLastMessageAt(conversation.id);
  
    return messageText;
  };
  
  export const handleAddItemFromWebhook = async (
    payload: WhatsAppWebhookPayload,
    menuItemId: string
  ): Promise<string | null> => {
    
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const from = message?.from;
    const phoneNumberId = value?.metadata?.phone_number_id;
  
    if (!phoneNumberId || !from || !menuItemId) return null;
  
    const business = await findBusinessByPhoneNumberId(phoneNumberId);
    if (!business) return null;
  
    const customer = await findOrCreateCustomer(business.id, from);
    const conversation = await createOrGetOpenConversation(business.id, customer.id);
    await findOrCreateConversationState(conversation.id);
  
    return await buildAddItemMessage(business, conversation, menuItemId, customer);
  };
