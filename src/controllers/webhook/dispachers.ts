// src/controllers/webhook/dispatchers.ts

import { handlers } from './handlers';
import { 
  WebhookContext, 
  EnrichedContext, 
  HandlerResult, 
  InteractiveHandler, 
  IntentHandler,
  IntentClassification 
} from './types';

// Type guards
const isInteractiveHandler = (handler: any): handler is InteractiveHandler => {
  return 'matches' in handler && typeof handler.matches === 'function';
};

const isIntentHandler = (handler: any): handler is IntentHandler => {
  return 'canHandle' in handler && typeof handler.canHandle === 'function';
};

// Dispatcher de botones
export const dispatchInteractive = async (
  ctx: WebhookContext
): Promise<HandlerResult | null> => {
  
  if (!ctx.payloadId) {
    console.log('[DispatchInteractive] No payloadId');
    return null;
  }

  const handler = handlers.find(h => 
    isInteractiveHandler(h) && h.matches(ctx.payloadId!)
  );
  
  if (!handler) {
    console.log('[DispatchInteractive] No handler for:', ctx.payloadId);
    return null;
  }

  console.log('[DispatchInteractive]', (handler as InteractiveHandler).command);
  return (handler as InteractiveHandler).execute(ctx);
};

// Dispatcher de intenciones
export const dispatchIntent = async (
  ctx: EnrichedContext
): Promise<HandlerResult | null> => {
  
  const { detection } = ctx;
  
  const handler = handlers.find(h => 
    isIntentHandler(h) && h.canHandle(detection.intent)
  );
  
  if (!handler) {
    console.log('[DispatchIntent] No handler for:', detection.intent);
    return null;
  }

  console.log('[DispatchIntent]', (handler as IntentHandler).command);
  
  const classification: IntentClassification = {
    intent: detection.intent,
    confidence: detection.confidence,
    detectedProductName: detection.detectedProductName,
    quantity: detection.quantity
  };

  return (handler as IntentHandler).execute(ctx, classification);
};