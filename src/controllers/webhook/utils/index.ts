import { HandlerResult } from '../types';

export const parseProductId = (payloadId: string): string => {
    return payloadId.split(':')[1] ?? '';
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
        switch (message.interative.type){
            case 'button_reply':
                return message.interactive.button_reply.id;
            case 'list_reply':
                return message.interactive.list_reply.id;
            default:
                return undefined;
        }
    }
    return undefined;
};

// src/controllers/webhook/handlerHelpers.ts


export const textResponse = (content: string): HandlerResult => ({
  content,
  isInteractive: false
});

export const listResponse = (listMessage: any): HandlerResult => ({
  content: listMessage,
  isInteractive: true
});

export const interactiveResponse = (interactiveMessage: any): HandlerResult => ({
  content: interactiveMessage,
  isInteractive: true
});

export const noResponse = (): null => null;