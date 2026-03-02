// webhooks/extractor.ts
import { WhatsAppWebhookPayload, WebhookContext } from './types';
import { extractPayloadId } from './utils';

export const extractContext = (payload: WhatsAppWebhookPayload): WebhookContext | null => {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];
  const phoneNumberId = value?.metadata?.phone_number_id;
  const to = message?.from;
  console.log('[Extractor] Extracted context:', {
    phoneNumberId,
    to,
    message,
    value,
  });

  if (!message) {
    console.log('[Extractor] No message found, ignoring...');
    return null;
  }

  // Extraer payloadId una sola vez aquí
  const payloadId = extractPayloadId(message);

  return {
    payload,
    phoneNumberId,
    to,
    message,
    value,
    payloadId  // Ya procesado, los handlers lo usan directo
  };
};



