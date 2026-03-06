// services/cartService.ts

import { business, conversation, customer, draft_order_item, menu_item } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createConversationMessage, findBusinessByPhoneNumberId, findOrCreateConversationState, updateConversationLastMessageAt, updateConversationState } from "../repositories";
import { findOrCreateCustomer } from "../repositories/customer.repository";
import { createOrGetOpenConversation } from "../repositories/conversation.repository";
import { WhatsAppWebhookPayload } from "../controllers/webhook/types";
import { WhatsAppInteractiveMessage, WhatsAppListMessage } from "src/domain/intent/whatsappTemplates";
import { extractOrderData } from "./ai/openai.service";
import { order_item } from "@prisma/client";
import { ConversationIntent } from "../types/conversationIntent";
import { handleDraftOrder, handleDraftOrderItem } from "./order.service";

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
): Promise<WhatsAppInteractiveMessage | string | null> => {

  

    const cart = await handleDraftOrder(business, customer);
    if (!cart) return 'Error al crear el pedido.';
  

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



  const existingItem = await prisma.draft_order_item.findFirst({
    where: { draft_order_id: cart.id, product_id: item.id }
  });

  console.log('debug: existingItem', existingItem);

  if (existingItem) {
    console.log('debug: existingItem found, updating quantity and total price');
    await prisma.draft_order_item.update({  
      where: { draft_order_id: cart.id, id: existingItem.id },
      data: { quantity: existingItem.quantity + 1, total_price: existingItem.total_price.add(item.menu_item_price[0]?.amount.toNumber() || 0 * existingItem.quantity) }
    });
  } else {
    console.log('debug: existingItem not found, creating new item');
    await prisma.draft_order_item.create({
      data: { draft_order_id: cart.id, product_id: item.id, quantity: 1, unit_price: item.menu_item_price[0]?.amount.toNumber() || 0, total_price: item.menu_item_price[0]?.amount.toNumber() || 0 * 1 }
    });
  }

  const itemCount = await prisma.draft_order_item.count({ where: { draft_order_id: cart.id } });
  const total = await prisma.draft_order_item.aggregate({
    where: { draft_order_id: cart.id },
    _sum: { total_price: true }
  });

  const messageText = `🛒 *${item.name}* agregado\n\n` +
    `Items en carrito: ${itemCount}\n` +
    `Total: $${total._sum.total_price || 0}\n\n` +
    `¿Seguís comprando o querés *finalizar*?`;

  await createConversationMessage(conversation.id, 'ai', messageText, false);
  await updateConversationLastMessageAt(conversation.id);

  return {
    type: 'interactive',
    interactive: {
      header: { type: 'text', text: '' },
      type: 'button',
      footer: { text: '*Pedido actualizado*' },
      body: {
        text: `*${item.name}* agregado\n\n` +
          `Articulos en tu pedido: ${itemCount}\n` +
          `Total: $${total._sum.total_price?.toNumber() || 0}\n\n` +
          `¿Seguís comprando o querés *finalizar*?`
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'VIEW_MENU', title: 'Seguir comprando' } },
          { type: 'reply', reply: { id: 'CHECKOUT', title: 'Finalizar pedido' } },
          { type: 'reply', reply: { id: 'VIEW_CART_FOR_EDITION', title: 'Modificar pedido' } }
        ]
      }
    }
  };
};

export const handleAddItemFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  menuItemId: string
): Promise<WhatsAppInteractiveMessage | null | string> => {

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

  const AIResponse = await extractOrderData(message?.text?.body ?? '');
  console.log('AIResponse', AIResponse);

  const draftOrder = await prisma.draft_order.findFirst({
    where: {
      business_id: business.id,
      customer_phone: customer.phone_number,
      status: 'active'
    },
    include: {
      draft_order_item: {  // ← Nombre correcto según tu schema
        include: { menu_item: true }
      }
    }
  });

  return buildAddItemMessage(business, conversation, menuItemId, customer);
};

export const buildConfirmRemoveItemMessage = async (
  business: business,
  conversation: conversation,
  customer: customer,
  itemIdentifier: string // id del item
): Promise<ConfirmRemoveItemResult> => {

  // Buscar carrito activo
  const cartItems = await prisma.draft_order.findFirst({
    where: {
      business_id: business.id,
      customer_phone: customer.phone_number,
      status: 'active'
    },
    include: {
      draft_order_item: {  // ← Nombre correcto según tu schema
        include: { menu_item: true }
      }
    }
  });

  if (!cartItems || cartItems.draft_order_item.length === 0) {
    const errorText = 'No tenés items en tu carrito para remover.';
    await createConversationMessage(conversation.id, 'ai', errorText, false);
    await updateConversationLastMessageAt(conversation.id);
    return { message: null, errorMessage: errorText };
  }

  // Buscar ítem que coincida (por nombre o id)
  const matchingItem = cartItems.draft_order_item.find(ci =>
    ci.menu_item?.id === itemIdentifier
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
        text: `¿Querés remover *${matchingItem.menu_item?.name}* (cantidad: ${matchingItem.quantity}) de tu carrito?`
      },
      footer: {
        text: 'Esta acción no se puede deshacer'
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `CONFIRM_REMOVE:${matchingItem.menu_item?.id}`,
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
      pendingItemId: matchingItem.menu_item?.id ?? '',
      pendingItemName: matchingItem.menu_item?.name ?? ''
    }
  });

  await createConversationMessage(
    conversation.id,
    'ai',
    `Solicitud de confirmación para remover ${matchingItem.menu_item?.name ?? ''}`,
    false
  );
  await updateConversationLastMessageAt(conversation.id);

  return { message: confirmMessage };
};

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
    customer,
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

export const handleShowCartForEditionFromWebhook = async (
  payload: WhatsAppWebhookPayload
): Promise<WhatsAppListMessage | WhatsAppInteractiveMessage | string | null> => {

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

  // 🔎 Obtener items del carrito

  const cartItems = await prisma.draft_order.findFirst({
    where: {
      business_id: business.id,
      customer_phone: customer.phone_number,
      status: 'active'

    },
    include: {
      draft_order_item: {  // ← Nombre correcto según tu schema
        include: { menu_item: true }
      }
    }
  });

  if (!cartItems?.draft_order_item.length) {
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        header: {
          type: 'text',
          text: ''
        },
        body: {
          text: 'Tu pedido está vacío 🛒'
        },
        footer: {
          text: 'Mira nuestro menú'
        },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'VIEW_MENU', title: 'Seguir comprando' } },
          ]
        }
      }
    };
  }

  return {
    type: 'list',
    header: {
      type: 'text',
      text: ''
    },
    body: {
      text: '*Este es tu pedido*\n\nSelecciona el producto que querés modificar 👇'
    },
    footer: {
      text: 'Podrás cambiar cantidad o removerlo'
    },
    action: {
      button: 'Ver platillos',
      sections: [
        {
          title: 'Platillos en tu pedido',
          rows: cartItems.draft_order_item.map(item => ({
            id: `SELECT_CART_ITEM:${item.menu_item?.id ?? ''}`,
            title: `${item.quantity}x ${item.menu_item?.name ?? ''}`,
            description: 'Modificar o remover'
          }))
        }
      ]
    }
  };
};

export const handleViewCartFromWebhook = async (
  payload: WhatsAppWebhookPayload
): Promise<WhatsAppListMessage | string | null> => {

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

  const cartItems = await prisma.draft_order.findFirst({
    where: {
      business_id: business.id,
      customer_phone: customer.phone_number,
      status: 'active'

    },
    include: {
      draft_order_item: {  // ← Nombre correcto según tu schema
        include: { menu_item: true }
      }
    }
  });

  if (!cartItems?.draft_order_item.length) {
    return 'Tu carrito está vacío 🛒';
  }

  // 🔢 Construir resumen
  const summary = cartItems
    .draft_order_item.map((item: draft_order_item & { menu_item: menu_item | null }) => `${item.quantity}x ${item.menu_item?.name ?? ''} ${item.unit_price.toNumber()}${business.currency_code ?? 'ARS'}`)
    .join('\n');
  const total = cartItems.draft_order_item.reduce((acc: number, item) => acc + item.unit_price.toNumber() * item.quantity, 0);

  return {
    type: 'list',
    header: {
      type: 'text',
      text: ''
    },
    body: {
      text: `*Tu pedido actual*\n\n${summary}\n\nTotal: ${total}${business.currency_code ?? 'ARS'}\n\n¿Qué deseas hacer ahora?`
    },
    footer: {
      text: 'Selecciona una opción'
    },
    action: {
      button: 'Opciones',
      sections: [
        {
          title: 'Gestión del pedido',
          rows: [
            {
              id: 'VIEW_CART_FOR_EDITION',
              title: 'Modificar pedido',
              description: 'Cambiar cantidades o remover productos'
            },
            {
              id: 'VIEW_MENU',
              title: 'Seguir comprando',
              description: 'Agregar más productos'
            },
            {
              id: 'CHECKOUT',
              title: 'Finalizar pedido',
              description: 'Proceder al pago'
            },
            {
              id: 'CANCEL_ORDER',
              title: 'Cancelar pedido',
              description: 'Eliminar el pedido actual'
            }
          ]
        }
      ]
    }
  };
};

export const handleCartItemSelectionFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  orderItemId: string | undefined
): Promise<WhatsAppListMessage | string | null> => {

  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from || !orderItemId || orderItemId === undefined) {
    return null;
  }

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) return null;

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);

  const conversationState = await findOrCreateConversationState(conversation.id);
  const draftOrder = await prisma.draft_order.findFirst({
    where: {
      business_id: business.id,
      customer_phone: customer.phone_number,
      status: 'active'
    },
    include: {
      draft_order_item: {  // ← Nombre correcto según tu schema
        include: { menu_item: true }
      }
    }
  });
  if (!draftOrder) {
    return 'No se encontró el pedido.'
  }

  // Buscar item del carrito
  const orderItem = draftOrder.draft_order_item.find(item => item.product_id === orderItemId);

  console.log('orderItem', orderItem);
  console.log('draftOrder', draftOrder);
  console.log('orderItemId', orderItemId);
  if (!orderItem) {
    return 'Ese producto no está en tu pedido.';
  }

  console.log('---- CART ITEM SELECTED ----');
  console.log('OrderItemId:', orderItem.id);
  console.log('Product:', orderItem);
  console.log('Quantity:', orderItem.quantity);
  console.log('----------------------------');

  // Guardar estado conversacional
  await updateConversationState(conversation.id, {
    metadata: {
      pendingAction: 'EDIT_CART',
      pendingItemId: orderItem.id,
      pendingItemName: orderItem.menu_item?.name
    }
  });

  const bodyText =
    `Seleccionaste *${orderItem.menu_item?.name}*\n` +
    `Cantidad actual: ${orderItem.quantity}\n\n` +
    `¿Qué deseas hacer?`;

  const interactiveMessage: WhatsAppListMessage = {
    type: 'list',
    header: {
      type: 'text',
      text: ''
    },
    body: {
      text: bodyText
    },
    footer: {
      text: 'Selecciona una opción'
    },
    action: {
      button: 'Opciones',
      sections: [
        {
          title: 'Gestión del pedido',
          rows: [
            {
              id: `INCREASE_ITEM_QUANTITY:${orderItem.menu_item?.id}`,
              title: '➕ Aumentar cantidad',
              description: 'Aumentar la cantidad del producto'
            },
            {
              id: `DECREASE_ITEM_QUANTITY:${orderItem.menu_item?.id}`,
              title: '➖ Disminuir cantidad',
              description: 'Disminuir la cantidad del producto'
            },
            {
              id: `CONFIRM_REMOVE:${orderItem.menu_item?.id}`,
              title: '🗑 Remover',
              description: 'Remover el producto del pedido'
            },
            {
              id: 'VIEW_CART',
              title: '⬅ Volver',
              description: 'Volver a la lista de productos'
            }
          ]
        }
      ]
    }
  };


  await createConversationMessage(conversation.id, 'ai', bodyText, false);
  await updateConversationLastMessageAt(conversation.id);

  return interactiveMessage;
};

export const handleSelectQuantityDecreaseItemFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  itemID: string | undefined
): Promise<WhatsAppListMessage | string | null> => {

  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];
  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from || !itemID || itemID === undefined) return null;

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) return null;

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);
  await findOrCreateConversationState(conversation.id);

  const draftOrder = await handleDraftOrder(business, customer);

  const draftOrderItem = await handleDraftOrderItem(draftOrder, itemID);


  if (!draftOrderItem) return 'Ese producto ya no está disponible en tu pedido.';

  return await buildSelectQuatityDecreaseItemMessage(draftOrderItem);
};

export const handleSelectQuantityIncreaseItemFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  itemID: string | undefined
): Promise<WhatsAppListMessage | string | null> => {

  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];
  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from || !itemID || itemID === undefined) return null;

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) return null;

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);
  await findOrCreateConversationState(conversation.id);

  const draftOrder = await handleDraftOrder(business, customer);
  const draftOrderItem = await handleDraftOrderItem(draftOrder, itemID);

  console.log('draftOrderItem handleSelectQuantityIncreaseItemFromWebhook', draftOrderItem);
  if (!draftOrderItem) return 'Ese producto ya no está disponible en tu pedido.';

  return await buildSelectQuantityIncreaseItemMessage(draftOrderItem);
};

const buildSelectQuatityDecreaseItemMessage = async (
  draftOrderItem: draft_order_item & { menu_item: menu_item | null },
): Promise<WhatsAppListMessage> => {

  const rowsList: {
    id: string
    title: string
    description: string
  }[] = [];

  const currentQty = draftOrderItem.quantity;

  // Caso especial: solo hay 1 unidad
  if (currentQty === 1) {

    rowsList.push({
      id: `CONFIRM_REMOVE:${draftOrderItem.menu_item?.id}`,
      title: '❌ Remover',
      description: 'Remover el platillo del pedido'
    });

  } else {

    // Nunca permitir disminuir hasta 0
    const maxDecrease = currentQty - 1;

    // Limitar para evitar listas gigantes
    const allowedOptions = Math.min(maxDecrease, 7);

    for (let amount = 1; amount <= allowedOptions; amount++) {
      rowsList.push({
        id: `DECREASE_ITEM_QUANTITY:${draftOrderItem.menu_item?.id}:${amount}`,
        title: `Disminuir ${amount}`,
        description: `Reducir ${amount} del pedido`
      });
    }

    rowsList.push({
      id: `CONFIRM_REMOVE:${draftOrderItem.menu_item?.id}`,
      title: '❌ Remover',
      description: 'Remover el platillo del pedido'
    });
  }

  // siempre permitir volver
  rowsList.push({
    id: ConversationIntent.VIEW_CART,
    title: '⬅ Volver',
    description: 'Volver al pedido'
  });

  return {
    type: 'list',
    header: {
      type: 'text',
      text: draftOrderItem.menu_item?.name ?? 'Platillo'
    },
    body: {
      text: `Cantidad actual: ${currentQty}`
    },
    footer: {
      text: currentQty === 1
        ? 'Solo puedes remover el platillo'
        : 'Selecciona cuánto deseas disminuir'
    },
    action: {
      button: 'Seleccionar',
      sections: [
        {
          title: 'Opciones',
          rows: rowsList
        }
      ]
    }
  };
};

const buildSelectQuantityIncreaseItemMessage = async (
  draftOrderItem: draft_order_item & { menu_item: menu_item | null },
): Promise<WhatsAppListMessage> => {
  console.log('draftOrderItem buildSelectQuantityIncreaseItemMessage', draftOrderItem);
  const rowsList: {
    id: string
    title: string
    description: string
  }[] = [];

  const currentQty = draftOrderItem.quantity;
  const maxIncrease = 9;
  for (let amount = 1; amount <= maxIncrease; amount++) {
    rowsList.push({
      id: `INCREASE_ITEM:${draftOrderItem.menu_item?.id}:${amount}`,
      title: `Aumentar ${amount}`,
      description: `Aumentar ${amount} del pedido`
    });
  }

  // siempre permitir volver
  rowsList.push({
    id: ConversationIntent.VIEW_CART,
    title: '⬅ Volver',
    description: 'Volver al pedido'
  });

  return {
    type: 'list',
    header: {
      type: 'text',
      text: draftOrderItem.menu_item?.name ?? 'Platillo'
    },
    body: {
      text: `Cantidad actual: ${currentQty}`
    },
    footer: {
      text: 'Selecciona cuánto deseas aumentar'
    },
    action: {
      button: 'Seleccionar',
      sections: [
        {
          title: 'Opciones',
          rows: rowsList
        }
      ]
    }
  };
};

const buildDecreaseItemQuantitySuccessMessage = async (
  orderItem: menu_item,
  quantity: number
): Promise<WhatsAppInteractiveMessage> => {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: 'Pedido actualizado' },
      body: { text: `Se disminuyò la cantidad de ${quantity} en para el platillo ${orderItem.name} en el pedido. \n\n¿Querés seguir comprando? \n\nEscribe "Ver menu" para agregar más platillos.` },
      footer: { text: '¿Querés seguir comprando o finalizar tu orden?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'VIEW_CART', title: 'Volver al pedido' } },
          { type: 'reply', reply: { id: 'CHECKOUT', title: 'Finalizar pedido' } },
          { type: 'reply', reply: { id: 'CANCEL_ORDER', title: 'Cancelar pedido' } }
        ]
      }
    }
  };
};

const buildIncreaseItemQuantitySuccessMessage = async (
  orderItem: menu_item,
  quantity: number
): Promise<WhatsAppInteractiveMessage> => {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: 'Pedido actualizado' },
      body: { text: `Se aumentò la cantidad de ${quantity} en para el platillo ${orderItem.name} en el pedido. \n\n¿Querés seguir comprando? \n\nEscribe "Ver menu" para agregar más platillos.` },
      footer: { text: '¿Querés seguir comprando o finalizar tu orden?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'VIEW_CART', title: 'Volver al pedido' } },
          { type: 'reply', reply: { id: 'CHECKOUT', title: 'Finalizar pedido' } },
          { type: 'reply', reply: { id: 'CANCEL_ORDER', title: 'Cancelar pedido' } }
        ]
      }
    }
  };
};

export const decreaseItemQuantityFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  itemID: string | undefined,
  quantity: number
): Promise<WhatsAppInteractiveMessage | string | null> => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];
  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;
  if (!phoneNumberId || !from || !itemID || itemID === undefined) return null;

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) return null;

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);
  await findOrCreateConversationState(conversation.id);

  const draftOrder = await handleDraftOrder(business, customer);

  const draftOrderItem = await handleDraftOrderItem(draftOrder, itemID);


  if (!draftOrderItem) return 'Ese producto ya no está disponible en tu pedido.';

  const newQuantity = draftOrderItem.quantity - quantity;
  if (newQuantity < 1) return 'La cantidad del platillo no puede ser menor a 1.';
  await prisma.draft_order_item.update({
    where: { id: draftOrderItem.id },
    data: { quantity: newQuantity }
  });

  return await buildDecreaseItemQuantitySuccessMessage(draftOrderItem.menu_item!, quantity);
};

export const increaseItemQuantityFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  itemID: string | undefined,
  quantity: number
): Promise<WhatsAppInteractiveMessage | string | null> => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];
  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;
  const maxQuantity = 10;
  if (!phoneNumberId || !from || !itemID || itemID === undefined) return null;

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) return null;

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);
  await findOrCreateConversationState(conversation.id);

  const draftOrder = await handleDraftOrder(business, customer);

  const draftOrderItem = await handleDraftOrderItem(draftOrder, itemID);


  if (!draftOrderItem) return 'Ese producto ya no está disponible en tu pedido.';

  const newQuantity = draftOrderItem.quantity + quantity;
  if (newQuantity > maxQuantity) return 'La cantidad del platillo no puede ser mayor a 10.';
  await prisma.draft_order_item.update({
    where: { id: draftOrderItem.id },
    data: { quantity: newQuantity }
  });

  return await buildIncreaseItemQuantitySuccessMessage(draftOrderItem.menu_item!, quantity);
};

export const handleConfirmAddItemFromWebhook = async (
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

  return await buildConfirmAddItemMessage(
    business,
    conversation,
    customer,
    itemIdentifier
  );

};

const buildConfirmAddItemMessage = async (
  business: business,
  conversation: conversation,
  customer: customer,
  itemIdentifier: string
): Promise<WhatsAppInteractiveMessage | string | null> => {
  const cartItems = await prisma.draft_order.findFirst({
    where: {
      business_id: business.id,
      customer_phone: customer.phone_number,
      status: 'active'
    },
    include: {
      draft_order_item: {
        include: { menu_item: true }
      }
    }
  });
  if (!cartItems) return 'No se encontró el platillo.';
  const matchingItem = cartItems.draft_order_item.find(ci =>
    ci.menu_item?.id === itemIdentifier
  );
  if (!matchingItem) return 'No se encontró el platillo.';
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: '¿Agregar ítem?' },
      body: { text: `¿Querés agregar *${matchingItem.menu_item?.name}* al pedido?` },
      footer: { text: '¿Querés agregar *${matchingItem.menu_item?.name}* al pedido?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `CONFIRM_ADD:${matchingItem.menu_item?.id}`, title: '✅ Sí, agregar' } },
          { type: 'reply', reply: { id: 'VIEW_MENU', title: '⬅ Volver' } }
        ]
      }
    }
  };
};


