import { Request, Response } from 'express';
import { WhatsAppWebhookPayload } from './webhook/types';
import { processWebhook } from './webhook/orchestrator';

export const handleWebhook = async (
  req: Request<{}, {}, WhatsAppWebhookPayload>,
  res: Response
): Promise<void> => {
  // 1. Responder inmediatamente a WhatsApp
  res.sendStatus(200);
  
  // 2. Delegar TODO el procesamiento
  await processWebhook(req.body);
};