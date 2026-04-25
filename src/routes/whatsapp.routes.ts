import { Router } from 'express';
import {
  sendMessage,
  proxyWebhook,
} from '../controllers/whatsapp.controller.v2';

const router = Router();

/**
 * @route   GET /api/whatsapp/webhook
 * @desc    Reenviar verificacion del webhook de WhatsApp
 * @access  Public
 */
router.get('/webhook', proxyWebhook);

/**
 * @route   POST /api/whatsapp/webhook
 * @desc    Reenviar eventos webhook de WhatsApp
 * @access  Public
 */
router.post('/webhook', proxyWebhook);

/**
 * @route   POST /api/whatsapp/send
 * @desc    Enviar mensaje de WhatsApp
 * @access  Public (deberías agregar autenticación)
 */
router.post('/send', sendMessage);

export default router;

