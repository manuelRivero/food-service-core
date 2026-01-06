export interface WhatsAppMessage {
  from: string;
  to: string;
  message: string;
  timestamp?: Date;
  messageId?: string;
}

export interface WhatsAppWebhook {
  event: string;
  data: {
    from: string;
    to: string;
    message?: string;
    mediaUrl?: string;
    type: 'text' | 'image' | 'video' | 'audio' | 'document';
  };
}

export interface SendMessageRequest {
  to: string;
  message: string;
  mediaUrl?: string;
}

export interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

