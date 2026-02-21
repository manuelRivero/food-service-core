import {
  SendMessageRequest,
  WhatsAppWebhookPayload
} from '../types/whatsapp';
import {
  createOrGetOpenConversation,
  createConversationMessage,
  findBusinessByPhoneNumberId,
  findOrCreateConversationState,
  findOrCreateCustomer,
  updateConversationLastMessageAt
} from '../repositories';

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

  const messageContent = text ?? `[${message.type ?? 'unknown'}]`;

  await createConversationMessage(conversation.id, 'customer', messageContent);
  await updateConversationLastMessageAt(conversation.id);

  // TODO: Procesar el mensaje aquí (respuestas automáticas, etc.)
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
