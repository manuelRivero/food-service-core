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
export const handleWebhook = (req: Request, res: Response): void => {
  console.log('📩 Webhook recibido RAW');
  console.dir(req.body, { depth: null });
  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const message = value?.messages?.[0];

  if (!message) {
    console.log('ℹ️ Evento sin mensaje (status / system)');

    // Eventos tipo status, delivery, read, etc
    res.sendStatus(200);
    return;
  }

  const from = message.from;               // teléfono del cliente
  const text = message.text?.body;         // mensaje
  const phoneNumberId = value.metadata?.phone_number_id;

  console.log('📩 Mensaje recibido');
  console.log('From:', from);
  console.log('Text:', text);
  console.log('PhoneNumberId:', phoneNumberId);

  // TODO: Procesar el mensaje aquí
  // Ejemplo: guardar en BD, responder automáticamente, etc.

  res.sendStatus(200);
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