// webhooks/handlers/fallbackHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { processIncomingMessage } from '../../../services/whatsapp.service';

export class FallbackHandler extends BaseHandler {
  readonly command = 'FALLBACK';
  
  matches(): boolean {
    return true; // Catch-all para cualquier payloadId (o sin payloadId)
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    // Procesa mensajes de texto normales o interacciones no reconocidas
    const response = await processIncomingMessage(ctx.payload);
    
    if (!response) {
      return this.noResponse();
    }

    console.log('---- FINAL BOT RESPONSE ----');
    console.log(response);
    console.log('----------------------------');

    if (!response) {
      return null;
    }
  
    // Detectar tipo
    if (typeof response === 'string') {
      return this.textResponse(response);
    }
    
    // Es WhatsAppListMessage o WhatsAppInteractiveMessage
    if (response.type === 'list') {
      return this.listResponse(response);
    }
    
    return this.interactiveResponse(response);
  }
}