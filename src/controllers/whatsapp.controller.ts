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
 * Maneja los webhooks POST de WhatsApp (mensajes entrantes)
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

    // WhatsApp requiere respuesta 200 rápida (dentro de 20 segundos)
    res.status(200).json({
      success: true,
      message: 'Webhook procesado correctamente'
    });
  } catch (error) {
    console.error('Error al procesar webhook:', error);
    // Aún así respondemos 200 para que WhatsApp no reintente
    res.status(200).json({
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


export const receiveMessage = (req: Request, res: Response) => {
  console.log('📩 Incoming WhatsApp webhook:')
  console.dir(req.body, { depth: null })

  // WhatsApp exige 200 rápido
  return res.sendStatus(200)
}