import { Request, Response } from 'express';
import axios from 'axios';
import {
  SendMessageRequest,
  SendMessageResponse
} from '../types/whatsapp';
import {
  sendTextMessage,
  ValidationError
} from '../services/whatsapp.service';

const REMOTE_WEBHOOK_URL = 'https://food-service-langraph.onrender.com/api/whatsapp/webhook';

export const proxyWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const response = await axios({
      method: req.method,
      url: REMOTE_WEBHOOK_URL,
      params: req.query,
      data: req.body,
      headers: {
        'x-hub-signature-256': req.header('x-hub-signature-256') ?? '',
        'content-type': req.header('content-type') ?? 'application/json'
      },
      validateStatus: () => true
    });

    res.status(response.status).set(response.headers).send(response.data);
  } catch (error) {
    console.error('Error reenviando webhook a backend LangGraph:', error);
    res.status(502).json({
      success: false,
      error: 'No se pudo reenviar el webhook al backend de automatizacion'
    });
  }
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