import { Request, Response } from 'express';
import { SendMessageRequest, SendMessageResponse } from '../types/whatsapp';

/**
 * Envía un mensaje de WhatsApp
 */
export const sendMessage = async (
  req: Request<{}, SendMessageResponse, SendMessageRequest>,
  res: Response<SendMessageResponse>
): Promise<void> => {
  try {
    const { to, message, mediaUrl } = req.body;

    // Validaciones básicas
    if (!to || !message) {
      res.status(400).json({
        success: false,
        error: 'Los campos "to" y "message" son requeridos'
      });
      return;
    }

    // TODO: Implementar lógica de envío de mensaje
    // Aquí iría la integración con la API de WhatsApp
    
    const messageId = `msg_${Date.now()}`;

    res.status(200).json({
      success: true,
      messageId
    });
  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
};

/**
 * Maneja los webhooks de WhatsApp
 */
export const handleWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const webhookData = req.body;

    // TODO: Implementar lógica de procesamiento de webhook
    // Aquí iría el procesamiento de mensajes entrantes
    
    console.log('Webhook recibido:', webhookData);

    res.status(200).json({
      success: true,
      message: 'Webhook procesado correctamente'
    });
  } catch (error) {
    console.error('Error al procesar webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Error al procesar webhook'
    });
  }
};

/**
 * Verifica el webhook (para configuración inicial)
 */
export const verifyWebhook = (req: Request, res: Response): void => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.status(403).json({
      success: false,
      error: 'Token de verificación inválido'
    });
  }
};

