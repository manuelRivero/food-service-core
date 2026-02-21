import axios, { AxiosError } from 'axios';

export class WhatsAppSenderService {
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  private normalizeRecipient(to: string): string {
    // Ajuste para AR: remover el "9" después del "54" si existe (ej: 549... -> 54...)
    if (to.startsWith('549')) {
      return `54${to.slice(3)}`;
    }

    return to;
  }

  async sendTextMessage(params: {
    phoneNumberId: string;
    to: string;
    message: string;
  }): Promise<void> {
    const { phoneNumberId, to, message } = params;
    const normalizedTo = this.normalizeRecipient(to);

    try {
      await axios.post(
        `${this.baseUrl}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: normalizedTo,
          type: 'text',
          text: {
            body: message
          }
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`
          }
        }
      );
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const data = axiosError.response?.data;

      const messageDetail =
        typeof data === 'string' ? data : JSON.stringify(data ?? {});

      throw new Error(
        `Error al enviar mensaje WhatsApp: ${status ?? 'sin_status'} ${messageDetail}`
      );
    }
  }

  async sendInteractiveMenu(params: {
    phoneNumberId: string;
    to: string;
    text: string;
    buttons: { title: string; payload: string }[];
    page?: number;
    totalPages?: number;
  }): Promise<void> {
    console.log('sendInteractiveMenu', params);
    console.log('sendInteractiveMenu to', params.to);
    const { phoneNumberId, to, text, buttons, page, totalPages } = params;
    const normalizedTo = this.normalizeRecipient(to);
    const isButton = buttons.length <= 3;
    const bodyText =
      page && totalPages
        ? `${text}\n\nPágina ${page} de ${totalPages}`
        : text;

    const interactive = isButton
      ? {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.map((button) => ({
              type: 'reply',
              reply: { id: button.payload, title: button.title }
            }))
          }
        }
      : {
          type: 'list',
          body: { text: bodyText },
          action: {
            button: 'Ver categorías',
            sections: [
              {
                title: 'Categorías',
                rows: buttons.map((button) => ({
                  id: button.payload,
                  title: button.title
                }))
              }
            ]
          }
        };

    try {
      await axios.post(
        `${this.baseUrl}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: normalizedTo,
          type: 'interactive',
          interactive
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`
          }
        }
      );
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const data = axiosError.response?.data;

      const messageDetail =
        typeof data === 'string' ? data : JSON.stringify(data ?? {});

      throw new Error(
        `Error al enviar mensaje WhatsApp: ${status ?? 'sin_status'} ${messageDetail}`
      );
    }
  }
}
