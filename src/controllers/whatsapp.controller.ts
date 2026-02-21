import { Request, Response } from 'express';
import {
  SendMessageRequest,
  SendMessageResponse,
  WhatsAppWebhookPayload
} from '../types/whatsapp';
import {
  handleCategorySelectionFromWebhook,
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
  res.sendStatus(200);
  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];
  const interactive = message?.interactive;
  const payloadId = interactive?.button_reply?.id ?? interactive?.list_reply?.id;

  if (payloadId?.startsWith('VIEW_CATEGORY_')) {
    const categoryId = payloadId.replace('VIEW_CATEGORY_', '');
    void handleCategorySelectionFromWebhook(req.body, categoryId).catch((error: unknown) => {
      console.error('Async webhook processing error:', error);
    });
    return;
  }

  void processIncomingMessage(req.body).catch((error: unknown) => {
    console.error('Async webhook processing error:', error);
  });
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