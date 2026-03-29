import { Request, Response } from 'express';
import {
  SendMessageRequest,
  SendMessageResponse,
  WhatsAppWebhookPayload
} from '../types/whatsapp';
import {
  handleAddItemFromWebhook,
  handleAskQuestionFromWebhook,
  handleCancelOrderFromWebhook,
  handleCategorySelectionFromWebhook,
  handleCheckoutFromWebhook,
  handleEndConversationFromWebhook,
  handleOrderProductSelectionFromWebhook,
  handleOrderSearchPageFromWebhook,
  handleProductSelectionFromWebhook,
  handleViewCategoriesFromWebhook,
  processIncomingMessage,
  sendTextMessage,
  ValidationError,
  verifyWebhook as verifyWebhookService
} from '../services/whatsapp.service';
import { WhatsAppSenderService } from '../services/whatsappSender.service';
import { WhatsAppListMessage } from '../domain/intent/whatsappTemplates';

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
  const payloadId =
    message?.type === 'interactive'
      ? message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id
      : undefined;

  if (payloadId) {
    if (payloadId.startsWith('SELECT_PRODUCT:')) {
      const productId = payloadId.replace('SELECT_PRODUCT:', '');
      void (async () => {
        const response = await handleProductSelectionFromWebhook(req.body, productId);
        if (!response) {
          return;
        }
        const phoneNumberId = value?.metadata?.phone_number_id;
        const to = message?.from;
        if (!phoneNumberId || !to) {
          return;
        }
        const sender = new WhatsAppSenderService();

          await sender.sendInteractiveMessage({
            phoneNumberId,
            to,
            messageObject: response
          }
          );
        
      })().catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId.startsWith('SELECT_ORDER_PRODUCT:')) {
      const productId = payloadId.replace('SELECT_ORDER_PRODUCT:', '');
      void (async () => {
        const response = await handleOrderProductSelectionFromWebhook(req.body, productId);
        if (!response) {
          return;
        }
        const phoneNumberId = value?.metadata?.phone_number_id;
        const to = message?.from;
        if (!phoneNumberId || !to) {
          return;
        }
        const sender = new WhatsAppSenderService();
        await sender.sendResponse({
          phoneNumberId,
          to,
          content: response
        });
      })().catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId.startsWith('ORDER_SEARCH_PAGE:')) {
      const [, pageValue] = payloadId.split(':');
      const page = Number(pageValue);
      void (async () => {
        const response = await handleOrderSearchPageFromWebhook(
          req.body,
          Number.isFinite(page) ? page : 1
        );
        if (!response) {
          return;
        }
        const phoneNumberId = value?.metadata?.phone_number_id;
        const to = message?.from;
        if (!phoneNumberId || !to) {
          return;
        }
        const sender = new WhatsAppSenderService();
        await sender.sendResponse({
          phoneNumberId,
          to,
          content: response
        });
      })().catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId.startsWith('CATEGORY_PAGE:')) {
      const [, categoryId, pageValue] = payloadId.split(':');
      const page = Number(pageValue);
      void handleCategorySelectionFromWebhook(
        req.body,
        categoryId ?? '',
        Number.isFinite(page) ? page : 1
      ).catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId.startsWith('CATEGORY_LIST_PAGE:')) {
      const [, pageValue] = payloadId.split(':');
      const page = Number(pageValue);
      void handleViewCategoriesFromWebhook(
        req.body,
        Number.isFinite(page) ? page : 1,
        true
      ).catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId.startsWith('CATEGORY:')) {
      const categoryId = payloadId.split(':')[1] ?? '';
      void handleCategorySelectionFromWebhook(req.body, categoryId, 1).catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId.startsWith('ADD_ITEM:')) {
      const menuItemId = payloadId.split(':')[1] ?? '';
      void handleAddItemFromWebhook(req.body, menuItemId).catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId === 'CHECKOUT') {
      void handleCheckoutFromWebhook(req.body).catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId === 'CANCEL_ORDER') {
      void handleCancelOrderFromWebhook(req.body).catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId === 'END_CONVERSATION') {
      void handleEndConversationFromWebhook(req.body).catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId === 'ASK_QUESTION') {
      void handleAskQuestionFromWebhook(req.body).catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
    if (payloadId === 'VIEW_MENU_RETURN') {
      void handleViewCategoriesFromWebhook(req.body, 1, true).catch((error: unknown) => {
        console.error('Async webhook processing error:', error);
      });
      return;
    }
  }

  void (async () => {
    const response = await processIncomingMessage(req.body);
    if (!response) {
      return;
    }

    const phoneNumberId = value?.metadata?.phone_number_id;
    const to = message?.from;
    if (!phoneNumberId || !to) {
      return;
    }

    console.log('---- FINAL BOT RESPONSE ----');
    console.log(response);
    console.log('----------------------------');

    const sender = new WhatsAppSenderService();
    await sender.sendResponse({
      phoneNumberId,
      to,
      content: response
    });
  })().catch((error: unknown) => {
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