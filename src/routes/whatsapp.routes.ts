import { Router } from 'express';
import {
  sendMessage,
  verifyWebhook
} from '../controllers/whatsapp.controller';
import { processWebhook } from '../controllers/webhook';

const router = Router();

/**
 * @route   GET /api/whatsapp/webhook
 * @desc    Verificar webhook de WhatsApp
 * @access  Public
 */
router.get('/webhook', verifyWebhook);

/**
 * @route   POST /api/whatsapp/webhook
 * @desc    Recibir webhooks de WhatsApp
 * @access  Public
 */
router.post('/webhook', processWebhook);

/**
 * @route   POST /api/whatsapp/send
 * @desc    Enviar mensaje de WhatsApp
 * @access  Public (deberías agregar autenticación)
 */
router.post('/send', sendMessage);

export default router;

