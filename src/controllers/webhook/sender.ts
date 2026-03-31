// src/controllers/webhook/sender.ts
import { WhatsAppSenderService } from '../../services/whatsappSender.service';
import { WebhookContext, HandlerResult } from './types';
import { WhatsAppListMessage, WhatsAppInteractiveMessage } from '../../domain/intent/whatsappTemplates';

const sender = new WhatsAppSenderService();

const normalizeArgentinaRecipient = (to: string): string => {
  const digits = to.replace(/\D/g, '');
  if (digits.startsWith('549')) {
    const withoutNine = `54${digits.slice(3)}`;
    if (withoutNine.length > 12) {
      const rest = withoutNine.slice(2);
      const nineIndex = rest.indexOf('9');
      if (nineIndex >= 0) {
        return `54${rest.slice(0, nineIndex)}${rest.slice(nineIndex + 1)}`;
      }
    }
    return withoutNine;
  }

  if (digits.startsWith('54') && digits.length > 12) {
    const rest = digits.slice(2);
    const nineIndex = rest.indexOf('9');
    if (nineIndex >= 0) {
      return `54${rest.slice(0, nineIndex)}${rest.slice(nineIndex + 1)}`;
    }
  }

  return digits;
};

export const sendResponse = async (
  ctx: WebhookContext, 
  result: HandlerResult
): Promise<void> => {
  console.log('[SendResponse] Sending response:', result);
  
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

export const sendResponseWithQrSequence = async (
  ctx: WebhookContext,
  result: HandlerResult
): Promise<void> => {
  await sendResponse(ctx, result);

  if (!result.followUps?.length) {
    return;
  }

  for (const follow of result.followUps) {
    if (follow.type === 'image') {
      await sender.sendImageFromDataUrl({
        phoneNumberId: ctx.phoneNumberId,
        to: ctx.to,
        dataUrl: follow.dataUrl
      });
    } else if (follow.type === 'text') {
      await sender.sendTextMessage({
        phoneNumberId: ctx.phoneNumberId,
        to: ctx.to,
        message: follow.message
      });
    }
  }
};

export const sendResponseNoContext = async (
  phoneNumberId: string,
  to: string,
  result: string
): Promise<void> => {
  console.log('[SendResponse] Sending response:', result);
  
  await sender.sendTextMessage({
    phoneNumberId: phoneNumberId,
    to: normalizeArgentinaRecipient(to),
    message: result
  });
};

export const sendListResponseNoContext = async (
  phoneNumberId: string,
  to: string,
  listMessage: WhatsAppListMessage
): Promise<void> => {
  console.log('[SendResponse] Sending list response');

  await sender.sendListMessage({
    phoneNumberId: phoneNumberId,
    to: normalizeArgentinaRecipient(to),
    listMessage
  });
};