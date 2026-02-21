import { Request, Response } from 'express';
import {
  SendMessageRequest,
  SendMessageResponse,
  WhatsAppWebhookPayload
} from '../types/whatsapp';
import {
  processIncomingMessage,
  sendTextMessage,
  ValidationError,
  verifyWebhook as verifyWebhookService
} from '../services/whatsapp.service';

/**
 * Envía un mensaje de WhatsApp
 */
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

/**
 * Maneja los webhooks POST de WhatsApp (mensajes entrantes)
 */
export const handleWebhook = async (
  req: Request<{}, {}, WhatsAppWebhookPayload>,
  res: Response
): Promise<void> => {
  try {
    await processIncomingMessage(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('Error al procesar webhook:', error);
    res.sendStatus(500);
  }
};

/**
 * Verifica el webhook (para configuración inicial)
 */
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