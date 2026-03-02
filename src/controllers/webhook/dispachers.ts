// src/controllers/webhook/dispatchers.ts

import { handlers } from './handlers';
import {
  EnrichedContext,
  HandlerResult,
  IntentHandler,
  IntentClassification
} from './types';



const isIntentHandler = (handler: any): handler is IntentHandler => {
  return 'canHandle' in handler && typeof handler.canHandle === 'function';
};

// Dispatcher de intenciones y botones, todo junto
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