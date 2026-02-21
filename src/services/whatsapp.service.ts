import {
  SendMessageRequest,
  WhatsAppWebhookPayload
} from '../types/whatsapp';
import {
  createOrGetOpenConversation,
  createConversationMessage,
  findBusinessByPhoneNumberId,
  findBusinessById,
  findByWhatsappMessageId,
  getRecentMessagesByConversationId,
  findOrCreateConversationState,
  findOrCreateCustomer,
  findCustomerById,
  updateConversationLastMessageAt
} from '../repositories';
import type { OpenAI as OpenAITypes } from 'openai';
import { generateAIResponse } from './ai/openai.service';
import { detectIntent } from './conversationOrchestrator.service';
import { MenuService } from './menu.service';
import { ConversationIntent } from '../types/conversationIntent';
import { WhatsAppSenderService } from './whatsappSender.service';

const chunkButtons = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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
  const pages = chunkButtons(menuResponse.buttons, 10);
  const totalPages = pages.length;

  for (let i = 0; i < pages.length; i += 1) {
    await sender.sendInteractiveMenu({
      phoneNumberId: business.whatsapp_phone_id,
      to: customer.phone_number,
      text: menuResponse.text,
      buttons: pages[i],
      page: totalPages > 1 ? i + 1 : undefined,
      totalPages: totalPages > 1 ? totalPages : undefined
    });
  }
};

export const handleCategorySelectionFromWebhook = async (
  payload: WhatsAppWebhookPayload,
  categoryId: string
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
  await handleCategorySelection(business.id, customer.id, conversation.id, categoryId);
};

export const handleCategorySelection = async (
  businessId: string,
  customerId: string,
  conversationId: string,
  categoryId: string
): Promise<void> => {
  const [business, customer, itemsResponse] = await Promise.all([
    findBusinessById(businessId),
    findCustomerById(customerId),
    MenuService.getItemsByCategory({ businessId, customerId, categoryId })
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

  await createConversationMessage(conversationId, 'ai', itemsResponse.text, true);
  await updateConversationLastMessageAt(conversationId);

  const sender = new WhatsAppSenderService();
  await sender.sendInteractiveMenu({
    phoneNumberId: business.whatsapp_phone_id,
    to: customer.phone_number,
    text: itemsResponse.text,
    buttons: itemsResponse.buttons
  });
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

export const processIncomingMessage = async (
  payload: WhatsAppWebhookPayload
): Promise<void> => {
  console.log('📩 Webhook recibido RAW');
  console.dir(payload, { depth: null });

  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const message = value?.messages?.[0];
  const messageId = message?.id;

  if (!message) {
    await processStatus(payload);
    return;
  }

  const from = message.from;
  const text = message.text?.body;
  const phoneNumberId = value?.metadata?.phone_number_id;

  console.log('📩 Mensaje recibido');
  console.log('From:', from);
  console.log('Text:', text);
  console.log('PhoneNumberId:', phoneNumberId);

  if (!phoneNumberId || !from) {
    console.log('ℹ️ Mensaje sin phoneNumberId o from');
    return;
  }

  const business = await findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    console.log('ℹ️ No se encontró business para phoneNumberId');
    return;
  }

  const customer = await findOrCreateCustomer(business.id, from);
  const conversation = await createOrGetOpenConversation(business.id, customer.id);

  await findOrCreateConversationState(conversation.id);

  if (messageId) {
    const existingMessage = await findByWhatsappMessageId(messageId);
    if (existingMessage) {
      return;
    }
  }

  const messageContent = text ?? `[${message.type ?? 'unknown'}]`;

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
    return;
  }

  await updateConversationLastMessageAt(conversation.id);

  const recentMessages = await getRecentMessagesByConversationId(conversation.id, 20);
  const formattedMessages: OpenAITypes.Chat.ChatCompletionMessageParam[] =
    recentMessages.map((recentMessage) => ({
      role: recentMessage.is_ai_generated ? 'assistant' : 'user',
      content: recentMessage.message
    }));

  const intent = await detectIntent(formattedMessages);
  console.info('Detected intent:', intent);

  if (intent === ConversationIntent.VIEW_MENU) {
    await handleViewMenuIntent(business.id, customer.id, conversation.id);
    return;
  }

  const aiResponse = await generateAIResponse(business, formattedMessages);

  await createConversationMessage(conversation.id, 'ai', aiResponse.content, true, undefined, undefined, {
    promptTokens: aiResponse.usage.promptTokens,
    completionTokens: aiResponse.usage.completionTokens,
    totalTokens: aiResponse.usage.totalTokens,
    estimatedCostUsd: aiResponse.usage.estimatedCostUsd
  });
  await updateConversationLastMessageAt(conversation.id);
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
