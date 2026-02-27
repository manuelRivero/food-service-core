// src/controllers/webhook/sender.ts
import { WhatsAppSenderService } from '../../services/whatsappSender.service';
import { WebhookContext, HandlerResult } from './types';
import { WhatsAppListMessage, WhatsAppInteractiveMessage } from '../../domain/intent/whatsappTemplates';

const sender = new WhatsAppSenderService();

export const sendResponse = async (
  ctx: WebhookContext, 
  result: HandlerResult
): Promise<void> => {
  
  if (!result.isInteractive) {
    // Texto plano
    await sender.sendTextMessage({
      phoneNumberId: ctx.phoneNumberId,
      to: ctx.to,
      message: result.content as string
    });
    return;
  }

  const message = result.content;
  
  // Distinguir tipo de mensaje interactivo
  if ((message as WhatsAppListMessage).type && (message as WhatsAppListMessage).type === 'list') {
    await sender.sendListMessage({
      phoneNumberId: ctx.phoneNumberId,
      to: ctx.to,
      listMessage: message as WhatsAppListMessage
    });
  } else {
    // Asumimos que es botón u otro tipo interactivo
    await sender.sendButtonMessage({
      phoneNumberId: ctx.phoneNumberId,
      to: ctx.to,
      interactiveMessage: message as WhatsAppInteractiveMessage
    });
  }
};
