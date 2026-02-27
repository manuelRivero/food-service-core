// webhooks/handlers/selectProductHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { parseProductId } from '../utils';
import { handleProductSelectionFromWebhook } from '../../../services/whatsapp.service';

export class SelectProductHandler extends BaseHandler {
  readonly command = 'SELECT_PRODUCT';
  
  matches(payloadId: string): boolean {
    return payloadId.startsWith('SELECT_PRODUCT:');
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const productId = parseProductId(ctx.payloadId!);
    
    // Esta función ahora devuelve el objeto de mensaje, NO envía
    const messageObject = await handleProductSelectionFromWebhook(ctx.payload, productId);
    
    if (!messageObject) {
      return this.noResponse();
    }

    return this.interactiveResponse(messageObject);
  }
}