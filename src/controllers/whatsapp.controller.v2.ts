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

const LANGGRAPH_BASE_URL =
  process.env.LANGGRAPH_PROXY_URL ?? 'https://food-service-langraph.onrender.com';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length'
]);

function shouldForwardRequestBody(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD';
}

/**
 * Reenvía cualquier petición al backend LangGraph conservando path y query
 * (p. ej. /api/auth/login → LANGGRAPH_BASE_URL/api/auth/login).
 */
export const proxyRequestToLangGraph = async (
  req: Request,
  res: Response
): Promise<void> => {
  const targetUrl = `${LANGGRAPH_BASE_URL}${req.originalUrl}`;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers,
      data: shouldForwardRequestBody(req.method) ? req.body : undefined,
      validateStatus: () => true,
      responseType: 'arraybuffer',
      maxBodyLength: Infinity
    });

    const skipResponseHeaders = new Set(['transfer-encoding', 'connection']);
    for (const [key, value] of Object.entries(response.headers)) {
      if (value === undefined || skipResponseHeaders.has(key.toLowerCase())) {
        continue;
      }
      const v = value as string | string[];
      res.setHeader(key, v);
    }

    res.status(response.status).send(Buffer.from(response.data));
  } catch (error) {
    console.error('Error en proxy hacia LangGraph:', error);
    res.status(502).json({
      success: false,
      error: 'No se pudo contactar el backend de automatización'
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