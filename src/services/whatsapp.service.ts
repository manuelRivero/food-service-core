import {
  SendMessageRequest,
  WhatsAppWebhookPayload
} from '../types/whatsapp';
import {
  createOrGetOpenConversation,
  createConversationMessage,
  closeConversation,
  findBusinessByPhoneNumberId,
  findBusinessById,
  findByWhatsappMessageId,
  getRecentMessagesByConversationId,
  findOrCreateConversationState,
  updateConversationState,
  findOrCreateCustomer,
  findCustomerById,
  updateConversationLastMessageAt
} from '../repositories';
import type { OpenAI as OpenAITypes } from 'openai';
import { generateAIResponse } from './ai/openai.service';
import { detectIntentWithConfidence } from './conversationOrchestrator.service';
import { MenuService } from './menu.service';
import { ConversationIntent } from '../types/conversationIntent';
import { WhatsAppSenderService } from './whatsappSender.service';
import { Prisma } from '@prisma/client';
import type { ConfirmationState } from '../domain/intent/types';
import type { WhatsAppListMessage } from '../domain/intent/whatsappTemplates';
import { INTENT_SELECTION_ID_PREFIX } from '../domain/intent/whatsappTemplates';
import type {
  business as Business,
  conversation as Conversation,
  customer as Customer
} from '@prisma/client';
import { prisma } from '../lib/prisma';

const confirmationStates = new Map<string, ConfirmationState>();
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const CONFIRMATION_CLEANUP_MS = 10 * 60 * 1000;
const LIST_CONFIRMATION_REGEX = new RegExp(`^${INTENT_SELECTION_ID_PREFIX}([A-Z_]+)$`);

setInterval(() => {
  const now = new Date();
  for (const [phone, state] of confirmationStates.entries()) {
    if (state.status === 'awaiting_confirmation' && now > state.expiresAt) {
      confirmationStates.delete(phone);
    }
  }
}, CONFIRMATION_CLEANUP_MS);

const isListConfirmation = (
  messageText: string
): { isConfirmation: boolean; intent?: ConversationIntent } => {
  const match = messageText.match(LIST_CONFIRMATION_REGEX);
  if (match) {
    const intent = match[1] as ConversationIntent;
    if (Object.values(ConversationIntent).includes(intent)) {
      return { isConfirmation: true, intent };
    }
  }
  return { isConfirmation: false };
};

const chunkButtons = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const toRowTitle = (value: string, maxLength = 24): string => value.slice(0, maxLength);
const toRowDescription = (value: string, maxLength = 72): string => value.slice(0, maxLength);


const buildCategoryListPages = (
  buttons: { title: string; payload: string; description?: string; sectionTitle?: string }[],
  pageSize = 10
): { buttons: typeof buttons; page: number; totalPages: number }[] => {
  const itemsPerPage = Math.max(pageSize - 2, 1);
  const totalPages = Math.ceil(buttons.length / itemsPerPage);
  const pages: { buttons: typeof buttons; page: number; totalPages: number }[] = [];

  for (let page = 1; page <= totalPages; page += 1) {
    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageButtons = buttons.slice(start, end);
    const prevPage = page - 1;
    const nextPage = page + 1;

    if (prevPage >= 1) {
      pageButtons.push({
        title: 'Pagina anterior',
        payload: `CATEGORY_LIST_PAGE:${prevPage}`,
        description: 'Regresar a la pagina anterior',
        sectionTitle: 'Categorías'
      });
    }

    if (nextPage <= totalPages) {
      const nextStart = (nextPage - 1) * itemsPerPage;
      const nextEnd = nextStart + itemsPerPage;
      const nextTitles = buttons
        .slice(nextStart, nextEnd)
        .map((button) => button.title)
        .join(', ');

      pageButtons.push({
        title: 'Ver mas categorias',
        payload: `CATEGORY_LIST_PAGE:${nextPage}`,
        description: toRowDescription(nextTitles),
        sectionTitle: 'Categorías'
      });
    }

    pages.push({ buttons: pageButtons, page, totalPages });
  }

  return pages;
};

const buildProductListPages = (
  items: { title: string; payload: string; description?: string; sectionTitle?: string }[],
  categoryId: string,
  pageSize = 10
): { buttons: typeof items; page: number; totalPages: number }[] => {
  const itemsPerPage = Math.max(pageSize - 3, 1);
  const totalPages = Math.ceil(items.length / itemsPerPage);
  const pages: { buttons: typeof items; page: number; totalPages: number }[] = [];

  for (let page = 1; page <= totalPages; page += 1) {
    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageButtons = items.slice(start, end);
    const prevPage = page - 1;
    const nextPage = page + 1;

    if (prevPage >= 1) {
      pageButtons.push({
        title: 'Pagina anterior',
        payload: `CATEGORY_PAGE:${categoryId}:${prevPage}`,
        description: 'Regresar a la pagina anterior',
        sectionTitle: 'Platillos'
      });
    }

    if (nextPage <= totalPages) {
      const nextStart = (nextPage - 1) * itemsPerPage;
      const nextEnd = nextStart + itemsPerPage;
      const nextTitles = items
        .slice(nextStart, nextEnd)
        .map((item) => item.title)
        .join(', ');

      pageButtons.push({
        title: 'Ver mas platillos',
        payload: `CATEGORY_PAGE:${categoryId}:${nextPage}`,
        description: toRowDescription(nextTitles),
        sectionTitle: 'Platillos'
      });
    }

    pageButtons.push({
      title: 'Volver a categorias',
      payload: 'VIEW_MENU_RETURN',
      description: 'Elegir otra categoria',
      sectionTitle: 'Platillos'
    });

    pages.push({ buttons: pageButtons, page, totalPages });
  }

  return pages;
};

export const handleViewMenuIntent = async (
  businessId: string,
  customerId: string,
  conversationId: string
): Promise<void> => {
  const [business, customer, menuResponse] = await Promise.all([
    findBusinessById(businessId),
    findCustomerById(customerId),
    MenuService.getMenuForCustomer({ businessId, customerId })
  ]);

  if (!business) {
    throw new Error('Business no encontrado');
  }
  if (!customer) {
    throw new Error('Customer no encontrado');
  }
  if (!business.whatsapp_phone_id) {
    throw new Error('Business sin whatsapp_phone_id');
  }

  await createConversationMessage(conversationId, 'ai', menuResponse.text, true);
  await updateConversationLastMessageAt(conversationId);

  const sender = new WhatsAppSenderService();
  if (menuResponse.buttons.length === 0) {
    await sender.sendTextMessage({
      phoneNumberId: business.whatsapp_phone_id,
      to: customer.phone_number,
      message: menuResponse.text
    });
    return;
  }

  await sender.sendInteractiveMenu({
    phoneNumberId: business.whatsapp_phone_id,
    to: customer.phone_number,
    text: menuResponse.text,
    buttons: menuResponse.buttons
  });
  await updateConversationState(conversationId, { current_intent: 'greeted' });
};

export const handleViewCategoriesFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  page = 1,
  isReturn = false
): Promise<void> => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from) {
    return;
  }

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    return;
  }

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);

  const conversationState = await findOrCreateConversationState(conversation.id);
  await handleViewCategories(
    business.id,
    customer.id,
    conversation.id,
    from,
    phoneNumberId,
    page,
    isReturn
  );
  await updateConversationState(conversation.id, { current_intent: 'greeted' });
};

const handleViewCategories = async (
  businessId: string,
  customerId: string,
  conversationId: string,
  to: string,
  phoneNumberId: string,
  page = 1,
  isReturn = false
): Promise<void> => {
  const menuResponse = await MenuService.getCategoryListForCustomer({
    businessId,
    customerId
  });

  const sender = new WhatsAppSenderService();

  if (menuResponse.buttons.length === 0) {
    await sender.sendTextMessage({
      phoneNumberId,
      to,
      message: menuResponse.text
    });
    await createConversationMessage(conversationId, 'ai', menuResponse.text, true);
    await updateConversationLastMessageAt(conversationId);
    return;
  }

  const pages = buildCategoryListPages(menuResponse.buttons);
  const totalPages = pages.length;
  const safePage = Math.min(Math.max(page, 1), totalPages || 1);
  const currentPage = pages[safePage - 1];
  let pageText = `📋 Categorías (pagina ${safePage} de ${totalPages})\n\nSelecciona una categoría o usa las opciones para navegar.`;
  if (safePage === 1 && !isReturn) {
    const menuHeader = await MenuService.getMenuForCustomer({
      businessId,
      customerId
    });
    pageText = menuHeader.text;
  }

    await sender.sendInteractiveMenu({
    phoneNumberId,
    to,
    text: pageText,
    buttons: currentPage?.buttons ?? [],
    forceList: true,
      actionButtonLabel: 'Elige categoria',
    page: totalPages > 1 ? safePage : undefined,
    totalPages: totalPages > 1 ? totalPages : undefined
  });

  await createConversationMessage(conversationId, 'ai', menuResponse.text, true);
  await updateConversationLastMessageAt(conversationId);
};

export const handleCategorySelectionFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  categoryId: string,
  page = 1
): Promise<void> => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from || !categoryId) {
    return;
  }

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    return;
  }

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);

  const conversationState = await findOrCreateConversationState(conversation.id);
  await handleCategorySelection(business, conversation, categoryId, from, phoneNumberId, page);
};

export const handleAddItemFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  menuItemId: string
): Promise<void> => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from || !menuItemId) {
    return;
  }

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    return;
  }

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);

  const conversationState = await findOrCreateConversationState(conversation.id);
  await handleAddItemToDraftOrder(business, conversation, customer, menuItemId, from, phoneNumberId);
};

export const handleCheckoutFromWebhook = async (
  payload: WhatsAppWebhookPayload
): Promise<void> => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from) {
    return;
  }

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    return;
  }

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);

  const conversationState = await findOrCreateConversationState(conversation.id);
  await handleCheckout(business, conversation, customer, from, phoneNumberId);
};

export const handleAskQuestionFromWebhook = async (
  payload: WhatsAppWebhookPayload
): Promise<void> => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from) {
    return;
  }

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    return;
  }

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);

  const conversationState = await findOrCreateConversationState(conversation.id);

  const sender = new WhatsAppSenderService();
  const messageText =
    'Claro, estoy aqui para ayudarte. Escribe tu duda con total confianza y la reviso enseguida.';

  await sender.sendTextMessage({
    phoneNumberId,
    to: from,
    message: messageText
  });

  await createConversationMessage(conversation.id, 'ai', messageText, false);
  await updateConversationState(conversation.id, { current_intent: 'greeted' });
  await updateConversationLastMessageAt(conversation.id);
};

const sendAskQuestionPrompt = async (
  conversationId: string,
  to: string,
  phoneNumberId: string
): Promise<void> => {
  const sender = new WhatsAppSenderService();
  const messageText =
    'Claro, estoy aqui para ayudarte. Escribe tu duda con total confianza y la reviso enseguida.';

  await sender.sendTextMessage({
    phoneNumberId,
    to,
    message: messageText
  });

  await createConversationMessage(conversationId, 'ai', messageText, false);
  await updateConversationLastMessageAt(conversationId);
  await updateConversationState(conversationId, { current_intent: 'greeted' });
};

export const handleCancelOrderFromWebhook = async (
  payload: WhatsAppWebhookPayload
): Promise<void> => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from) {
    return;
  }

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    return;
  }

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);

  await findOrCreateConversationState(conversation.id);
  await handleCancelOrder(business, conversation, customer, from, phoneNumberId);
};

export const handleEndConversationFromWebhook = async (
  payload: WhatsAppWebhookPayload
): Promise<void> => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  const from = message?.from;
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!phoneNumberId || !from) {
    return;
  }

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    return;
  }

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);

  await findOrCreateConversationState(conversation.id);
  await handleEndConversation(conversation, from, phoneNumberId);
};

export const handleCategorySelection = async (
  business: Business,
  conversation: Conversation,
  categoryId: string,
  to: string,
  phoneNumberId: string,
  page = 1
): Promise<void> => {
  const category = await prisma.menu_category.findFirst({
    where: { id: categoryId, business_id: business.id, is_active: true },
    select: { id: true, name: true }
  });

  if (!category) {
    const sender = new WhatsAppSenderService();
    await sender.sendTextMessage({
      phoneNumberId,
      to,
      message: 'Categoría no encontrada'
    });
    await createConversationMessage(conversation.id, 'ai', 'Categoría no encontrada', false);
    await updateConversationLastMessageAt(conversation.id);
    return;
  }

  const businessCurrency = await prisma.business.findUnique({
    where: { id: business.id },
    select: { currency_code: true }
  });
  const currency = businessCurrency?.currency_code;
  const now = new Date();
  const priceWhere = {
    currency_code: currency ?? undefined,
    is_active: true,
    valid_from: { lte: now },
    OR: [{ valid_to: null }, { valid_to: { gte: now } }]
  };

  const items = await prisma.menu_item.findMany({
    where: {
      business_id: business.id,
      category_id: categoryId,
      is_available: true,
      menu_item_price: {
        some: priceWhere
      }
    },
    orderBy: { created_at: 'asc' },
    include: {
      menu_item_price: {
        where: priceWhere,
        orderBy: { valid_from: 'desc' },
        take: 1
      }
    }
  });

  if (items.length === 0) {
    const sender = new WhatsAppSenderService();
    await sender.sendTextMessage({
      phoneNumberId,
      to,
      message: 'No hay platillos disponibles en esta categoría.'
    });
    await createConversationMessage(
      conversation.id,
      'ai',
      'No hay platillos disponibles en esta categoría.',
      false
    );
    await updateConversationLastMessageAt(conversation.id);
    return;
  }

  const sender = new WhatsAppSenderService();
  const itemSummaries = items.map((item) => {
    const price = item.menu_item_price[0];
    const priceText = price
      ? `${price.amount.toFixed(2)} ${price.currency_code}`
      : 'N/A';
    return {
      title: toRowTitle(item.name),
      payload: `ADD_ITEM:${item.id}`,
      description: toRowDescription(priceText),
      sectionTitle: 'Platillos'
    };
  });

  const pages = buildProductListPages(itemSummaries, categoryId);
  const totalPages = pages.length;
  const safePage = Math.min(Math.max(page, 1), totalPages || 1);
  const currentPage = pages[safePage - 1];
  const text =
    totalPages > 1
      ? `Excelente eleccion! Estos son los platillos de ${category.name}. Selecciona uno para continuar.`
      : `Excelente eleccion! Estos son los platillos de ${category.name}. Selecciona uno para continuar.`;

  await sender.sendInteractiveMenu({
    phoneNumberId,
    to,
    text,
    buttons: currentPage?.buttons ?? [],
    forceList: true,
    actionButtonLabel: 'Ver platillos',
    page: totalPages > 1 ? safePage : undefined,
    totalPages: totalPages > 1 ? totalPages : undefined
  });

  await createConversationMessage(conversation.id, 'ai', text, false);

  await updateConversationLastMessageAt(conversation.id);
};

export const handleAddItemToDraftOrder = async (
  business: Business,
  conversation: Conversation,
  customer: Customer,
  menuItemId: string,
  to: string,
  phoneNumberId: string
): Promise<void> => {
  const businessCurrency = await prisma.business.findUnique({
    where: { id: business.id },
    select: { currency_code: true }
  });
  const currency = businessCurrency?.currency_code ?? customer.preferred_currency;
  if (!currency) {
    const sender = new WhatsAppSenderService();
    await sender.sendTextMessage({
      phoneNumberId,
      to,
      message: 'No tengo tu moneda preferida registrada para procesar el pedido.'
    });
    await createConversationMessage(
      conversation.id,
      'ai',
      'No tengo tu moneda preferida registrada para procesar el pedido.',
      false
    );
    await updateConversationLastMessageAt(conversation.id);
    return;
  }

  const now = new Date();
  const priceWhere = {
    currency_code: currency,
    is_active: true,
    valid_from: { lte: now },
    OR: [{ valid_to: null }, { valid_to: { gte: now } }]
  };

  const result = await prisma.$transaction(async (tx) => {
    let draftOrder = await tx.draft_order.findFirst({
      where: {
        business_id: business.id,
        customer_phone: customer.phone_number,
        status: 'active'
      }
    });

    if (!draftOrder) {
      draftOrder = await tx.draft_order.create({
        data: {
          business_id: business.id,
          customer_phone: customer.phone_number,
          status: 'active',
          currency
        }
      });
    }

    const existingItem = await tx.draft_order_item.findFirst({
      where: {
        draft_order_id: draftOrder.id,
        product_id: menuItemId
      }
    });

    let itemName = '';

    if (existingItem) {
      const newQuantity = existingItem.quantity + 1;
      const totalPrice = existingItem.unit_price.mul(newQuantity);
      await tx.draft_order_item.update({
        where: { id: existingItem.id },
        data: {
          quantity: newQuantity,
          total_price: totalPrice
        }
      });

      const menuItem = await tx.menu_item.findUnique({
        where: { id: menuItemId },
        select: { name: true }
      });
      itemName = menuItem?.name ?? '';
    } else {
      const menuItem = await tx.menu_item.findUnique({
        where: { id: menuItemId },
        select: { name: true }
      });
      itemName = menuItem?.name ?? '';

      const price = await tx.menu_item_price.findFirst({
        where: {
          menu_item_id: menuItemId,
          ...priceWhere
        },
        orderBy: { valid_from: 'desc' }
      });

      if (!price) {
        throw new Error('Precio no encontrado para el producto');
      }

      await tx.draft_order_item.create({
        data: {
          draft_order_id: draftOrder.id,
          product_id: menuItemId,
          quantity: 1,
          unit_price: price.amount,
          total_price: price.amount
        }
      });
    }

    const items = await tx.draft_order_item.findMany({
      where: { draft_order_id: draftOrder.id }
    });

    const totalAmount = items.reduce(
      (acc, item) => acc.add(item.total_price),
      new Prisma.Decimal(0)
    );

    const updatedOrder = await tx.draft_order.update({
      where: { id: draftOrder.id },
      data: { total_amount: totalAmount }
    });

    return {
      items,
      total: updatedOrder.total_amount,
      currency
    };
  });

  await sendCurrentOrderSummary(business, conversation, customer, to, phoneNumberId);
};

const sendCurrentOrderSummary = async (
  business: Business,
  conversation: Conversation,
  customer: Customer,
  to: string,
  phoneNumberId: string
): Promise<void> => {
  const draftOrder = await prisma.draft_order.findFirst({
    where: {
      business_id: business.id,
      customer_phone: to,
      status: 'active'
    }
  });

  const sender = new WhatsAppSenderService();

  if (!draftOrder) {
    const message = 'No tienes un pedido activo.';
    await sender.sendTextMessage({ phoneNumberId, to, message });
    await createConversationMessage(conversation.id, 'ai', message, false);
    await updateConversationLastMessageAt(conversation.id);
    return;
  }

  const items = await prisma.draft_order_item.findMany({
    where: { draft_order_id: draftOrder.id }
  });

  if (items.length === 0) {
    const message = 'Tu pedido esta vacio.';
    await sender.sendTextMessage({ phoneNumberId, to, message });
    await createConversationMessage(conversation.id, 'ai', message, false);
    await updateConversationLastMessageAt(conversation.id);
    return;
  }

  const menuItemIds = items.flatMap((item) =>
    item.product_id ? [item.product_id] : []
  );
  const menuItems =
    menuItemIds.length > 0
      ? await prisma.menu_item.findMany({
          where: { id: { in: menuItemIds } },
          select: { id: true, name: true }
        })
      : [];
  const menuItemMap = new Map(menuItems.map((item) => [item.id, item.name]));

  const lines: string[] = ['🛒 Pedido actual:', ''];
  for (const item of items) {
    const name = item.product_id ? menuItemMap.get(item.product_id) ?? 'Platillo' : 'Platillo';
    lines.push(`- ${item.quantity}x ${name}`);
  }
  lines.push('', `Total: $${draftOrder.total_amount.toFixed(2)} ${draftOrder.currency}`);

  await sender.sendInteractiveMenu({
    phoneNumberId,
    to,
    text: lines.join('\n'),
    buttons: [
      { title: 'Agregar más', payload: 'VIEW_MENU_RETURN' },
      { title: 'Cancelar pedido', payload: 'CANCEL_ORDER' },
      { title: 'Finalizar pedido', payload: 'CHECKOUT' }
    ]
  });

  await createConversationMessage(conversation.id, 'ai', lines.join('\n'), false);
  await updateConversationLastMessageAt(conversation.id);
};

const handleCancelOrder = async (
  business: Business,
  conversation: Conversation,
  customer: Customer,
  to: string,
  phoneNumberId: string
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const draftOrder = await tx.draft_order.findFirst({
      where: {
        business_id: business.id,
        customer_phone: to,
        status: 'active'
      }
    });

    if (!draftOrder) {
      return;
    }

    await tx.draft_order_item.deleteMany({
      where: { draft_order_id: draftOrder.id }
    });

    await tx.draft_order.update({
      where: { id: draftOrder.id },
      data: {
        status: 'cancelled',
        total_amount: new Prisma.Decimal(0)
      }
    });
  });

  const sender = new WhatsAppSenderService();
  const message =
    'Tu pedido fue cancelado correctamente. ¿Quieres hacer otro pedido o terminar la conversacion?';

  await sender.sendInteractiveMenu({
    phoneNumberId,
    to,
    text: message,
    buttons: [
      { title: 'Empezar de nuevo', payload: 'VIEW_MENU_RETURN' },
      { title: 'Terminar chat', payload: 'END_CONVERSATION' }
    ]
  });

  await createConversationMessage(conversation.id, 'ai', message, false);
  await updateConversationLastMessageAt(conversation.id);
};

const handleEndConversation = async (
  conversation: Conversation,
  to: string,
  phoneNumberId: string
): Promise<void> => {
  await closeConversation(conversation.id);

  const sender = new WhatsAppSenderService();
  const message =
    'Gracias por escribirnos. Fue un gusto ayudarte. Cuando quieras, puedes volver a escribirnos y con gusto te atenderemos.';

  await sender.sendTextMessage({
    phoneNumberId,
    to,
    message
  });

  await createConversationMessage(conversation.id, 'ai', message, false);
  await updateConversationLastMessageAt(conversation.id);
};

export const handleCheckout = async (
  business: Business,
  conversation: Conversation,
  customer: Customer,
  to: string,
  phoneNumberId: string
): Promise<void> => {
  const result = await prisma.$transaction(async (tx) => {
    const draftOrder = await tx.draft_order.findFirst({
      where: {
        business_id: business.id,
        customer_phone: customer.phone_number,
        status: 'active'
      }
    });

    if (!draftOrder) {
      return { status: 'no_active' as const };
    }

    const items = await tx.draft_order_item.findMany({
      where: { draft_order_id: draftOrder.id }
    });

    if (items.length === 0) {
      return { status: 'empty' as const };
    }

    const totalAmount = items.reduce(
      (acc, item) => acc.add(item.total_price),
      new Prisma.Decimal(0)
    );

    const order = await tx.orders.create({
      data: {
        status: 'pending_payment',
        currency_code: draftOrder.currency,
        total_amount: totalAmount,
        conversation_id: conversation.id,
        customer_id: customer.id,
        business_id: business.id
      }
    });

    const orderItems = items.flatMap((item) =>
      item.product_id
        ? [
            {
              order_id: order.id,
              menu_item_id: item.product_id,
              quantity: item.quantity,
              unit_price: item.unit_price
            }
          ]
        : []
    );

    if (orderItems.length > 0) {
      await tx.order_item.createMany({ data: orderItems });
    }

    await tx.draft_order.update({
      where: { id: draftOrder.id },
      data: { status: 'converted' }
    });

    return {
      status: 'ok' as const,
      total: totalAmount,
      currency: draftOrder.currency
    };
  });

  const sender = new WhatsAppSenderService();

  if (result.status === 'no_active') {
    const message = 'No tienes un pedido activo.';
    await sender.sendTextMessage({ phoneNumberId, to, message });
    await createConversationMessage(conversation.id, 'ai', message, false);
    await updateConversationLastMessageAt(conversation.id);
    return;
  }

  if (result.status === 'empty') {
    const message = 'Tu pedido está vacío.';
    await sender.sendTextMessage({ phoneNumberId, to, message });
    await createConversationMessage(conversation.id, 'ai', message, false);
    await updateConversationLastMessageAt(conversation.id);
    return;
  }

  const totalText = `$${result.total.toFixed(2)} ${result.currency}`;
  const message = `🧾 Pedido confirmado\n\nTotal: ${totalText}\n\nEn breve recibirás el link de pago.`;
  await sender.sendTextMessage({ phoneNumberId, to, message });
  await createConversationMessage(conversation.id, 'ai', message, false);
  await updateConversationLastMessageAt(conversation.id);
};

export class ValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const sendTextMessage = async (
  payload: SendMessageRequest
): Promise<{ messageId: string }> => {
  const { to, message } = payload;

  if (!to || !message) {
    throw new ValidationError('Los campos "to" y "message" son requeridos');
  }

  // TODO: Implementar lógica de envío de mensaje con WhatsApp Cloud API
  const messageId = `msg_${Date.now()}`;

  return { messageId };
};

const buildListMessage = (params: {
  headerText: string;
  bodyText: string;
  footerText: string;
  actionButtonLabel: string;
  sections: Array<{ title: string; rows: Array<{ id: string; title: string; description: string }> }>;
}): WhatsAppListMessage => ({
  type: 'list',
  header: { type: 'text', text: params.headerText },
  body: { text: params.bodyText },
  footer: { text: params.footerText },
  action: {
    button: params.actionButtonLabel,
    sections: params.sections
  }
});

const buildListMessageFromButtons = (
  bodyText: string,
  buttons: { title: string; payload: string; description?: string; sectionTitle?: string }[],
  actionButtonLabel = 'Ver opciones disponibles',
  headerText = 'Opciones',
  footerText = 'Toca el botón de abajo para ver las opciones'
): WhatsAppListMessage => {
  const sections = new Map<string, Array<{ id: string; title: string; description: string }>>();
  for (const button of buttons) {
    const sectionTitle = button.sectionTitle ?? 'Opciones';
    const rows = sections.get(sectionTitle) ?? [];
    rows.push({
      id: button.payload,
      title: button.title,
      description: button.description ?? 'Selecciona esta opción'
    });
    sections.set(sectionTitle, rows);
  }

  return buildListMessage({
    headerText,
    bodyText,
    footerText,
    actionButtonLabel,
    sections: Array.from(sections.entries()).map(([title, rows]) => ({
      title,
      rows
    }))
  });
};

const buildSmallTalkResponse = async (
  conversationId: string,
  isFirstMessage: boolean,
  hasGreeted: boolean
): Promise<WhatsAppListMessage> => {
  const messageText = isFirstMessage && !hasGreeted
    ? 'Hola! Bienvenido/a 👋\nEstoy aqui para ayudarte. Elige una opcion para comenzar.'
    : 'Hola de nuevo! 😊\n¿Quieres ver el menu o tienes una duda?';

  await createConversationMessage(conversationId, 'ai', messageText, false);
  await updateConversationState(conversationId, { current_intent: 'greeted' });
  await updateConversationLastMessageAt(conversationId);

  return buildListMessage({
    headerText: '¿Cómo te ayudo?',
    bodyText: messageText,
    footerText: 'Toca el botón de abajo para ver las opciones',
    actionButtonLabel: 'Ver opciones',
    sections: [
      {
        title: 'Opciones',
        rows: [
          {
            id: 'VIEW_MENU_RETURN',
            title: 'Ver menú',
            description: 'Explorar categorías y platillos'
          },
          {
            id: 'ASK_QUESTION',
            title: 'Necesito info',
            description: 'Hacer una consulta'
          }
        ]
      }
    ]
  });
};

const buildUnknownResponse = async (
  conversationId: string
): Promise<WhatsAppListMessage> => {
  const messageText =
    'No estoy seguro de haber entendido. ¿Quieres ver el menu o necesitas informacion?';

  await createConversationMessage(conversationId, 'ai', messageText, false);
  await updateConversationLastMessageAt(conversationId);

  return buildListMessage({
    headerText: '¿Cómo te ayudo?',
    bodyText: messageText,
    footerText: 'Toca el botón de abajo para ver las opciones',
    actionButtonLabel: 'Ver opciones',
    sections: [
      {
        title: 'Opciones',
        rows: [
          {
            id: 'VIEW_MENU_RETURN',
            title: 'Ver menú',
            description: 'Explorar categorías y platillos'
          },
          {
            id: 'ASK_QUESTION',
            title: 'Necesito info',
            description: 'Hacer una consulta'
          }
        ]
      }
    ]
  });
};

const buildViewMenuResponse = async (
  businessId: string,
  customerId: string,
  conversationId: string,
  hasGreeted: boolean
): Promise<string | WhatsAppListMessage> => {
  if (!hasGreeted) {
    const menuResponse = await MenuService.getMenuForCustomer({ businessId, customerId });
    await createConversationMessage(conversationId, 'ai', menuResponse.text, true);
    await updateConversationLastMessageAt(conversationId);
    await updateConversationState(conversationId, { current_intent: 'greeted' });

    if (menuResponse.buttons.length === 0) {
      return menuResponse.text;
    }

    return buildListMessageFromButtons(
      menuResponse.text,
      menuResponse.buttons,
      'Ver opciones disponibles',
      'Menú'
    );
  }

  const menuResponse = await MenuService.getCategoryListForCustomer({
    businessId,
    customerId
  });

  const pages = buildCategoryListPages(menuResponse.buttons);
  const totalPages = pages.length;
  const safePage = Math.min(Math.max(1, 1), totalPages || 1);
  const currentPage = pages[safePage - 1];
  let pageText = `📋 Categorías (pagina ${safePage} de ${totalPages})\n\nSelecciona una categoría o usa las opciones para navegar.`;

  if (safePage === 1) {
    const menuHeader = await MenuService.getMenuForCustomer({
      businessId,
      customerId
    });
    pageText = menuHeader.text;
  }

  await createConversationMessage(conversationId, 'ai', menuResponse.text, true);
  await updateConversationLastMessageAt(conversationId);
  await updateConversationState(conversationId, { current_intent: 'greeted' });

  return buildListMessageFromButtons(
    pageText,
    currentPage?.buttons ?? [],
    'Elige categoria',
    'Categorías'
  );
};

const buildViewOrderResponse = async (
  business: Business,
  conversation: Conversation,
  customer: Customer,
  to: string
): Promise<string | WhatsAppListMessage> => {
  const draftOrder = await prisma.draft_order.findFirst({
    where: {
      business_id: business.id,
      customer_phone: to,
      status: 'active'
    }
  });

  if (!draftOrder) {
    const message = 'No tienes un pedido activo.';
    await createConversationMessage(conversation.id, 'ai', message, false);
    await updateConversationLastMessageAt(conversation.id);
    return message;
  }

  const items = await prisma.draft_order_item.findMany({
    where: { draft_order_id: draftOrder.id }
  });

  if (items.length === 0) {
    const message = 'Tu pedido esta vacio.';
    await createConversationMessage(conversation.id, 'ai', message, false);
    await updateConversationLastMessageAt(conversation.id);
    return message;
  }

  const menuItemIds = items.flatMap((item) =>
    item.product_id ? [item.product_id] : []
  );
  const menuItems =
    menuItemIds.length > 0
      ? await prisma.menu_item.findMany({
          where: { id: { in: menuItemIds } },
          select: { id: true, name: true }
        })
      : [];
  const menuItemMap = new Map(menuItems.map((item) => [item.id, item.name]));

  const lines: string[] = ['🛒 Pedido actual:', ''];
  for (const item of items) {
    const name = item.product_id ? menuItemMap.get(item.product_id) ?? 'Platillo' : 'Platillo';
    lines.push(`- ${item.quantity}x ${name}`);
  }
  lines.push('', `Total: $${draftOrder.total_amount.toFixed(2)} ${draftOrder.currency}`);

  const bodyText = lines.join('\n');

  await createConversationMessage(conversation.id, 'ai', bodyText, false);
  await updateConversationLastMessageAt(conversation.id);

  return buildListMessage({
    headerText: 'Pedido actual',
    bodyText,
    footerText: 'Toca el botón de abajo para ver las opciones',
    actionButtonLabel: 'Acciones',
    sections: [
      {
        title: 'Acciones',
        rows: [
          {
            id: 'VIEW_MENU_RETURN',
            title: 'Agregar más',
            description: 'Ver más platillos'
          },
          {
            id: 'CANCEL_ORDER',
            title: 'Cancelar pedido',
            description: 'Cancelar el pedido actual'
          },
          {
            id: 'CHECKOUT',
            title: 'Finalizar pedido',
            description: 'Continuar al pago'
          }
        ]
      }
    ]
  });
};

const buildResponse = async ({
  intent,
  business,
  customer,
  conversation,
  from,
  isFirstMessage,
  hasGreeted,
  formattedMessages
}: {
  intent: ConversationIntent;
  business: Business;
  customer: Customer;
  conversation: Conversation;
  from: string;
  isFirstMessage: boolean;
  hasGreeted: boolean;
  formattedMessages: OpenAITypes.Chat.ChatCompletionMessageParam[];
}): Promise<string | WhatsAppListMessage> => {
  if (intent === ConversationIntent.SMALL_TALK) {
    return buildSmallTalkResponse(conversation.id, isFirstMessage, hasGreeted);
  }

  if (intent === ConversationIntent.VIEW_MENU) {
    return buildViewMenuResponse(business.id, customer.id, conversation.id, hasGreeted);
  }

  if (intent === ConversationIntent.ASK_QUESTION) {
    const messageText =
      'Claro, estoy aqui para ayudarte. Escribe tu duda con total confianza y la reviso enseguida.';
    await createConversationMessage(conversation.id, 'ai', messageText, false);
    await updateConversationLastMessageAt(conversation.id);
    await updateConversationState(conversation.id, { current_intent: 'greeted' });
    return messageText;
  }

  if (intent === ConversationIntent.UNKNOWN) {
    return buildUnknownResponse(conversation.id);
  }

  if (intent === ConversationIntent.VIEW_ORDER) {
    return buildViewOrderResponse(business, conversation, customer, from);
  }

  const aiResponse = await generateAIResponse(business, formattedMessages);
  await createConversationMessage(conversation.id, 'ai', aiResponse.content, true, undefined, undefined, {
    promptTokens: aiResponse.usage.promptTokens,
    completionTokens: aiResponse.usage.completionTokens,
    totalTokens: aiResponse.usage.totalTokens,
    estimatedCostUsd: aiResponse.usage.estimatedCostUsd
  });
  await updateConversationLastMessageAt(conversation.id);
  return aiResponse.content;
};

const processConfirmationResponse = (
  response: string,
  candidates: Array<{ intent: ConversationIntent; label: string }>
): ConversationIntent | null => {
  const normalized = response.trim().toLowerCase();

  const numMatch = normalized.match(/^[1-9]$/);
  if (numMatch) {
    const index = parseInt(numMatch[0], 10) - 1;
    if (index >= 0 && index < candidates.length) {
      return candidates[index].intent;
    }
  }

  if (['sí', 'si', 'yes', 'ok', 'vale', 'correcto'].includes(normalized)) {
    return candidates[0].intent;
  }

  return null;
};

export const processIncomingMessage = async (
  payload: WhatsAppWebhookPayload
): Promise<string | WhatsAppListMessage> => {
  console.log('📩 Webhook recibido RAW');
  console.dir(payload, { depth: null });

  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const message = value?.messages?.[0];
  const messageId = message?.id;

  if (!message) {
    await processStatus(payload);
    return '';
  }

  const from = message.from;
  const text = message.text?.body;
  const interactiveId =
    message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.id;
  const phoneNumberId = value?.metadata?.phone_number_id;

  console.log('📩 Mensaje recibido');
  console.log('From:', from);
  console.log('Text:', text);
  console.log('PhoneNumberId:', phoneNumberId);

  if (!phoneNumberId || !from) {
    console.log('ℹ️ Mensaje sin phoneNumberId o from');
    return '';
  }

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    console.log('ℹ️ No se encontró business para phoneNumberId');
    return '';
  }

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);

  const conversationState = await findOrCreateConversationState(conversation.id);

  if (messageId) {
    const existingMessage = await findByWhatsappMessageId(messageId);
    if (existingMessage) {
      return '';
    }
  }

  const messageContent = text ?? interactiveId ?? `[${message.type ?? 'unknown'}]`;

  const persistedMessage = await createConversationMessage(
    conversation.id,
    'customer',
    messageContent,
    false,
    messageId,
    messageId
  );

  if (!persistedMessage) {
    console.log('Duplicate webhook ignored');
    return '';
  }

  await updateConversationLastMessageAt(conversation.id);

  const recentMessages = await getRecentMessagesByConversationId(conversation.id, 20);
  const formattedMessages: OpenAITypes.Chat.ChatCompletionMessageParam[] =
    recentMessages.map((recentMessage) => ({
      role: recentMessage.is_ai_generated ? 'assistant' : 'user',
      content: recentMessage.message
    }));
  const isFirstMessage = recentMessages.length === 1;
  const hasGreeted = conversationState.current_intent === 'greeted';

  const existingState = confirmationStates.get(from);
  const listCheck = isListConfirmation(messageContent);
  if (listCheck.isConfirmation && listCheck.intent) {
    if (existingState?.status === 'awaiting_confirmation') {
      if (new Date() > existingState.expiresAt) {
        confirmationStates.delete(from);
      } else {
        const isValidCandidate = existingState.candidates.some(
          (candidate) => candidate.intent === listCheck.intent
        );

        if (isValidCandidate) {
          confirmationStates.delete(from);
        console.info('Detected intent:', listCheck.intent);
        const responseContent = await buildResponse({
          intent: listCheck.intent,
          business,
          customer,
          conversation,
          from,
          isFirstMessage,
          hasGreeted,
          formattedMessages
        });
        return responseContent;
        }
        confirmationStates.delete(from);
      }
    }
  }

  if (!listCheck.isConfirmation && existingState?.status === 'awaiting_confirmation') {
    if (new Date() > existingState.expiresAt) {
      confirmationStates.delete(from);
    } else {
      const confirmationInput = text ?? messageContent;
      const confirmationResult = processConfirmationResponse(
        confirmationInput,
        existingState.candidates
      );

      confirmationStates.delete(from);

      if (confirmationResult) {
        console.info('Detected intent:', confirmationResult);
        const responseContent = await buildResponse({
          intent: confirmationResult,
          business,
          customer,
          conversation,
          from,
          isFirstMessage,
          hasGreeted,
          formattedMessages
        });
        return responseContent;
      }

      const messageText =
        'Disculpa, no entendí tu respuesta. ¿Puedes escribirme qué necesitas de otra forma?';
      await createConversationMessage(conversation.id, 'ai', messageText, false);
      await updateConversationLastMessageAt(conversation.id);
      return messageText;
    }
  }

  const detectionResult = await detectIntentWithConfidence(formattedMessages);

  if (detectionResult.type === 'UNCERTAIN') {
    const confirmationState: ConfirmationState = {
      status: 'awaiting_confirmation',
      candidates: detectionResult.candidates.map((candidate) => ({
        intent: candidate.intent,
        label: candidate.intent
      })),
      originalMessage: detectionResult.originalMessage,
      expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS)
    };

    confirmationStates.set(from, confirmationState);

    await createConversationMessage(
      conversation.id,
      'ai',
      detectionResult.listContent.body.text,
      false
    );
    await updateConversationLastMessageAt(conversation.id);
    return detectionResult.listContent;
  }

  console.info('Detected intent:', detectionResult.intent);
  const responseContent = await buildResponse({
    intent: detectionResult.intent,
    business,
    customer,
    conversation,
    from,
    isFirstMessage,
    hasGreeted,
    formattedMessages
  });
  return responseContent;
};

export const processStatus = async (
  payload: WhatsAppWebhookPayload
): Promise<void> => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const statuses = value?.statuses;

  console.log('ℹ️ Evento sin mensaje (status / system)');

  if (statuses?.length) {
    console.log('Statuses:', statuses);
  }
};

export const verifyWebhook = (
  query: Record<string, unknown>
): { isValid: boolean; challenge?: string } => {
  const mode = typeof query['hub.mode'] === 'string' ? query['hub.mode'] : undefined;
  const token =
    typeof query['hub.verify_token'] === 'string'
      ? query['hub.verify_token']
      : undefined;
  const challenge =
    typeof query['hub.challenge'] === 'string' ? query['hub.challenge'] : undefined;

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  const isValid = mode === 'subscribe' && token === verifyToken;

  return { isValid, challenge };
};
