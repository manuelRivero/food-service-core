// webhooks/handlers/orderSearchPageHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { parsePageOnly } from '../utils';
import { handleOrderSearchPageFromWebhook } from '../../../services/whatsapp.service';

export class OrderSearchPageHandler extends BaseHandler {
    readonly command = 'ORDER_SEARCH_PAGE';
    
    matches(payloadId: string): boolean {
      return payloadId.startsWith('ORDER_SEARCH_PAGE:');
    }
  
    async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
      const page = parsePageOnly(ctx.payloadId!);
      
      const result = await handleOrderSearchPageFromWebhook(ctx.payload, page);
      
      // Manejo de errores silenciosos
      if (result === null) {
        return null; // No se envía mensaje (error ya logueado en servicio)
      }
      
      // Mensaje de texto (error de metadata expirada)
      if (typeof result === 'string') {
        return this.textResponse(result);
      }
      
      // WhatsAppListMessage exitoso
      return this.listResponse(result);
    }
  }
  