// src/controllers/webhook/handlers/selectProductHandler.ts

import { InteractiveHandler, WebhookContext, HandlerResult } from '../types';
import { interactiveResponse, noResponse } from '../utils';
import { handleProductSelectionFromWebhook } from '../../../services/whatsapp.service';

export class SelectProductHandler implements InteractiveHandler {
  readonly command = 'SELECT_PRODUCT';
  
  matches(payloadId: string): boolean {
    return payloadId.startsWith('SELECT_PRODUCT:');
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const productId = ctx.payloadId!.replace('SELECT_PRODUCT:', '');
    
    const result = await handleProductSelectionFromWebhook(ctx.payload, productId);
    
    if (result === null) return noResponse();
    if (typeof result === 'string') {
      // Si retorna string, convertir a texto (aunque normalmente es interactivo)
      return { content: result, isInteractive: false };
    }
    
    return interactiveResponse(result);
  }
}