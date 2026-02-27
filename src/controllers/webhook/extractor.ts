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

  if (!phoneNumberId || !to || !message) {
    console.error('Invalid webhook payload structure:', {
      hasEntry: !!payload.entry,
      hasChanges: !!entry?.changes,
      hasValue: !!change?.value,
      hasMessages: !!value?.messages,
      messageCount: value?.messages?.length,
      hasPhoneNumberId: !!phoneNumberId,
      hasFrom: !!to,
      // NO loguear payload completo por privacidad, solo estructura
      keys: Object.keys(payload || {})
    });
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



