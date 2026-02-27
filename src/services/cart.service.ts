// services/cartService.ts

import { business, conversation, customer } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createConversationMessage, findBusinessByPhoneNumberId, findOrCreateConversationState, updateConversationLastMessageAt, updateConversationState } from "../repositories";
import { findOrCreateCustomer } from "../repositories/customer.repository";
import { createOrGetOpenConversation } from "../repositories/conversation.repository";
import { WhatsAppWebhookPayload } from "../controllers/webhook/types";
import { WhatsAppInteractiveMessage } from "src/domain/intent/whatsappTemplates";

interface ConfirmRemoveItemResult {
  message: WhatsAppInteractiveMessage | null;
  errorMessage?: string;
}

interface RemoveItemResult {
  message: WhatsAppInteractiveMessage | null;
  errorMessage?: string;
}
export const buildRemoveItemMessage = async (
  business: business,
  conversation: conversation,
  itemIdentifier: string
): Promise<RemoveItemResult> => {
  const cart = await prisma.orders.findFirst({
    where: { conversation_id: conversation.id },
    include: {
      order_item: {
        include: { menu_item: true }
      }
    }
  });
  if (!cart || cart.order_item.length === 0) {
    const errorText = 'No tenés platillos en tu orden para remover.';
    await createConversationMessage(conversation.id, 'ai', errorText, false);
    await updateConversationLastMessageAt(conversation.id);
    return { message: null, errorMessage: errorText };
  }


  const matchingItem = cart.order_item.find(ci =>
    ci.menu_item.id === itemIdentifier ||
    ci.menu_item.name.toLowerCase().includes(itemIdentifier.toLowerCase())
  );

  if (!matchingItem) {
    const errorText = `No encontré "${itemIdentifier}" en tu carrito.`;
    await createConversationMessage(conversation.id, 'ai', errorText, false);
    await updateConversationLastMessageAt(conversation.id);
    return { message: null, errorMessage: errorText };
  }
  const message: WhatsAppInteractiveMessage = {
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: 'Pedido actualizado' },
      footer: {
        text: '¿Querés seguir comprando o finalizar tu orden?'
      },
      body: {
        text: `Se removiò el platillo *${matchingItem.menu_item.name}*
       (cantidad: ${matchingItem.quantity}) de tu orden. 
       \n¿Querés seguir comprando?
       \n¿Querés finalizar tu orden?` },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: { id: 'VIEW_MENU', title: 'Seguir comprando' }
          },
          { type: 'reply', reply: { id: 'CHECKOUT', title: 'Finalizar' } }
        ]
      }
    }
  };
return { message: message };
};
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

/**
 * Construye mensaje de confirmación para remover ítem del carrito.
 * NO remueve, solo pregunta confirmación.
 */
export const buildConfirmRemoveItemMessage = async (
  business: business,
  conversation: conversation,
  itemIdentifier: string // nombre, id, o descripción del ítem
): Promise<ConfirmRemoveItemResult> => {

  // Buscar carrito activo
  const cart = await prisma.orders.findFirst({
    where: { conversation_id: conversation.id },
    include: {
      order_item: {
        include: { menu_item: true }
      }
    }
  });

  if (!cart || cart.order_item.length === 0) {
    const errorText = 'No tenés items en tu carrito para remover.';
    await createConversationMessage(conversation.id, 'ai', errorText, false);
    await updateConversationLastMessageAt(conversation.id);
    return { message: null, errorMessage: errorText };
  }

  // Buscar ítem que coincida (por nombre o id)
  const matchingItem = cart.order_item.find(ci =>
    ci.menu_item.id === itemIdentifier ||
    ci.menu_item.name.toLowerCase().includes(itemIdentifier.toLowerCase())
  );

  if (!matchingItem) {
    const errorText = `No encontré "${itemIdentifier}" en tu carrito.`;
    await createConversationMessage(conversation.id, 'ai', errorText, false);
    await updateConversationLastMessageAt(conversation.id);
    return { message: null, errorMessage: errorText };
  }

  // Construir mensaje de confirmación interactivo
  const confirmMessage: WhatsAppInteractiveMessage = {
    type: 'interactive',
    interactive: {
      type: 'button',
      header: {
        type: 'text',
        text: '¿Remover ítem?'
      },
      body: {
        text: `¿Querés remover *${matchingItem.menu_item.name}* (cantidad: ${matchingItem.quantity}) de tu carrito?`
      },
      footer: {
        text: 'Esta acción no se puede deshacer'
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `CONFIRM_REMOVE:${matchingItem.id}`,
              title: '✅ Sí, remover'
            }
          },
          {
            type: 'reply',
            reply: {
              id: 'CANCEL_REMOVE',
              title: '❌ No, cancelar'
            }
          }
        ]
      }
    }
  };

  // Guardar en metadata que estamos esperando confirmación
  await updateConversationState(conversation.id, {
    metadata: {
      pendingAction: 'CONFIRM_REMOVE',
      pendingItemId: matchingItem.id,
      pendingItemName: matchingItem.menu_item.name
    }
  });

  await createConversationMessage(
    conversation.id,
    'ai',
    `Solicitud de confirmación para remover ${matchingItem.menu_item.name}`,
    false
  );
  await updateConversationLastMessageAt(conversation.id);

  return { message: confirmMessage };
};

/**
 * Wrapper para webhook V2
 */
export const handleConfirmRemoveItemFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  itemIdentifier: string
): Promise<WhatsAppInteractiveMessage | string | null> => {

  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];
  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from || !itemIdentifier) return null;

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) return null;

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);
  await findOrCreateConversationState(conversation.id);

  const result = await buildConfirmRemoveItemMessage(
    business,
    conversation,
    itemIdentifier
  );

  if (result.errorMessage) return result.errorMessage;
  return result.message;
};

export const handleRemoveItemFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  itemIdentifier: string
): Promise<WhatsAppInteractiveMessage | string | null> => {

  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];
  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from || !itemIdentifier) return null;

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) return null;

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);
  await findOrCreateConversationState(conversation.id);

  const result = await buildRemoveItemMessage(
    business,
    conversation,
    itemIdentifier
  );

  if (result.errorMessage) return result.errorMessage;
  return result.message;
};