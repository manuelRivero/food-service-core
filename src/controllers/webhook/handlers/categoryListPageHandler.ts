// webhooks/handlers/categoryListPageHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { parsePageOnly } from '../utils';
import { handleCategoryListPageFromWebhook } from '../../../services/category.service';

export class CategoryListPageHandler extends BaseHandler {
  readonly command = 'CATEGORY_LIST_PAGE';
  
  matches(payloadId: string): boolean {
    return payloadId.startsWith('CATEGORY_LIST_PAGE:');
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const page = parsePageOnly(ctx.payloadId!);
    const result = await handleCategoryListPageFromWebhook(ctx.payload, page);
    if (result === null) return this.noResponse();
    if (typeof result === 'string') return this.textResponse(result);
    return this.listResponse(result);
  }
}