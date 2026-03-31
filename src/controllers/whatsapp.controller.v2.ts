import { Request, Response } from 'express';
import { WhatsAppWebhookPayload } from './webhook/types';
import { processWebhook } from './webhook/orchestrator';
import {
  SendMessageRequest,
  SendMessageResponse
} from '../types/whatsapp';
import {
  sendTextMessage,
  ValidationError,
  verifyWebhook as verifyWebhookService
} from '../services/whatsapp.service';

export const handleWebhook = async (
  req: Request<{}, {}, WhatsAppWebhookPayload>,
  res: Response
): Promise<void> => {
  // 1. Responder inmediatamente a WhatsApp
  res.sendStatus(200);
  
  // 2. Delegar TODO el procesamiento
  await processWebhook(req.body);
};

export const sendMessage = async (
  req: Request<{}, SendMessageResponse, SendMessageRequest>,
  res: Response<SendMessageResponse>
): Promise<void> => {
  try {
    const { messageId } = await sendTextMessage(req.body);

    res.status(200).json({
      success: true,
      messageId
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
      return;
    }

    console.error('Error al enviar mensaje:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
};

export const verifyWebhook = (req: Request, res: Response): void => {
  const { isValid, challenge } = verifyWebhookService(req.query);

  if (isValid) {
    console.log('Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.status(403).json({
      success: false,
      error: 'Token de verificación inválido'
    });
  }
};