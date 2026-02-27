// webhooks/index.ts
import { extractContext } from './extractor';
import { dispatch } from './dispatcher';
import { sendResponse } from './sender';
import { WhatsAppWebhookPayload } from './types';

export const processWebhook = async (payload: WhatsAppWebhookPayload): Promise<void> => {
  try {
    // Extraer datos necesarios
    const ctx = extractContext(payload);
    if (!ctx) {
      console.error('Invalid webhook payload structure');
      return;
    }

    // Ejecutar lógica de negocio
    console.log('ctx', ctx);
    const result = await dispatch(ctx);
    console.log('result', result);
    // Enviar respuesta si hay contenido
    if (result) {
      await sendResponse(ctx, result);
    }
    
  } catch (error) {
    console.error('Webhook processing error:', error);
  }
};