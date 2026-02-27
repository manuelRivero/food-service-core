// webhooks/handlers/viewMenuReturnHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { handleViewMenuReturnFromWebhook } from '../../../services/category.service';

export class ViewMenuReturnHandler extends BaseHandler {
  readonly command = 'VIEW_MENU_RETURN';
  
  matches(payloadId: string): boolean {
    return payloadId === 'VIEW_MENU_RETURN';
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const result = await handleViewMenuReturnFromWebhook(ctx.payload);
    if (result === null) return this.noResponse();
    if (typeof result === 'string') return this.textResponse(result);
    return this.listResponse(result);
  }
}