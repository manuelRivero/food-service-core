// webhooks/dispatcher.ts
import { handlers } from './handlers';
import { WebhookContext, HandlerResult, WebhookHandler } from './types';

export const dispatch = async (ctx: WebhookContext): Promise<HandlerResult | null> => {
  const payloadId = ctx.payloadId ?? '';
  
  // Encontrar handler que matchee
  const handler = handlers.find((h: WebhookHandler) => h.matches(payloadId));
  
  if (!handler) {
    console.error('No handler found for payloadId:', payloadId);
    return null;
  }

  console.log(`[Dispatcher] Executing handler: ${handler.command}`);
  
  try {
    return await handler.execute(ctx);
  } catch (error) {
    console.error(`[Dispatcher] Handler ${handler.command} failed:`, error);
    throw error; // Deja que processWebhook lo capture y loguee
  }
};