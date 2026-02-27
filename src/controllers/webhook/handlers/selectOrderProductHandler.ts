// webhooks/handlers/selectOrderProductHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { parseProductId } from '../utils';
import { handleOrderProductSelectionFromWebhook } from '../../../services/whatsapp.service';

export class SelectOrderProductHandler extends BaseHandler {
  readonly command = 'SELECT_ORDER_PRODUCT';
  
  matches(payloadId: string): boolean {
    return payloadId.startsWith('SELECT_ORDER_PRODUCT:');
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const productId = parseProductId(ctx.payloadId!);
    
    const content = await handleOrderProductSelectionFromWebhook(ctx.payload, productId);
    
    // Manejar string vacío como error silencioso
    if (!content) {
      return this.noResponse();
    }

    // Detectar tipo: string = texto, objeto = lista
    if (typeof content === 'string') {
      return this.textResponse(content);
    }

    // Es WhatsAppListMessage
    return this.listResponse(content);
  }
}