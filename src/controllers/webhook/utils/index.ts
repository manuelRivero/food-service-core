import { HandlerFollowUp, HandlerResult } from '../types';

export const parseProductId = (payloadId: string): string => {
    return payloadId.split(':')[1] ?? '';
};
export const parseQuantity = (payload: string): number | null => {
    const parts = payload.split(":");
    const last = parts[2];
  
    if (!last) return null;
  
    const amount = Number(last);
    return isNaN(amount) ? null : amount;
  };
export const parseCategoryPage = (payloadId: string): { categoryId: string; page: number } => {
    const [, categoryId, pageValue] = payloadId.split(':');
    const page = Number.isFinite(Number(pageValue)) ? Number(pageValue) : 1;
    return { categoryId: categoryId ?? '', page };
};

export const parsePageOnly = (payloadId: string): number => {
    const [, pageValue] = payloadId.split(':');
    return Number.isFinite(Number(pageValue)) ? Number(pageValue) : 1;
};

export const extractPayloadId = (message: any): string | undefined => {
    if (message.type === 'interactive') {
        console.log('[Extractor] Extracted payloadId:', message.interactive);
        switch (message.interactive.type){
            case 'button_reply':
                console.log('[Extractor] Extracted payloadId:', message.interactive.button_reply.id);
                return message.interactive.button_reply.id;
            case 'list_reply':
                console.log('[Extractor] Extracted payloadId:', message.interactive.list_reply.id);
                return message.interactive.list_reply.id;
            default:
                return undefined;
        }
    }
    return undefined;
};

// src/controllers/webhook/handlerHelpers.ts


export const textResponse = (
  content: string,
  followUps?: HandlerFollowUp[]
): HandlerResult => ({
  content,
  isInteractive: false,
  ...(followUps?.length ? { followUps } : {})
});

export const listResponse = (listMessage: any): HandlerResult => ({
  content: listMessage,
  isInteractive: true
});

export const interactiveResponse = (
  interactiveMessage: any,
  followUps?: HandlerFollowUp[]
): HandlerResult => ({
  content: interactiveMessage,
  isInteractive: true,
  ...(followUps?.length ? { followUps } : {})
});

export const noResponse = (): null => null;