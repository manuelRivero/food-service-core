import axios, { AxiosError } from 'axios';

export class WhatsAppSenderService {
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  private normalizeRecipient(to: string): string {
    const digits = to.replace(/\D/g, '');
    // Ajuste para AR: remover el "9" después del "54" si existe (ej: 549... -> 54...)
    if (digits.startsWith('549')) {
      const withoutNine = `54${digits.slice(3)}`;
      // Si queda un 9 extra luego del código de área, eliminarlo (ej: 54934 9... -> 5434...)
      if (withoutNine.length > 12) {
        const rest = withoutNine.slice(2);
        const nineIndex = rest.indexOf('9');
        if (nineIndex >= 0) {
          return `54${rest.slice(0, nineIndex)}${rest.slice(nineIndex + 1)}`;
        }
      }
      return withoutNine;
    }

    if (digits.startsWith('54') && digits.length > 12) {
      const rest = digits.slice(2);
      const nineIndex = rest.indexOf('9');
      if (nineIndex >= 0) {
        return `54${rest.slice(0, nineIndex)}${rest.slice(nineIndex + 1)}`;
      }
    }

    return digits;
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
    buttons: {
      title: string;
      payload: string;
      description?: string;
      sectionTitle?: string;
    }[];
    actionButtonLabel?: string;
    forceList?: boolean;
    page?: number;
    totalPages?: number;
  }): Promise<void> {
    console.log('sendInteractiveMenu', params);
    console.log('sendInteractiveMenu to', params.to);
    const {
      phoneNumberId,
      to,
      text,
      buttons,
      actionButtonLabel,
      forceList,
      page,
      totalPages
    } = params;
    const normalizedTo = this.normalizeRecipient(to);
    const isButton = !forceList && buttons.length <= 3;
    const bodyText =
      page && totalPages
        ? `${text}\n\nPágina ${page} de ${totalPages}`
        : text;

    const sections = new Map<
      string,
      { id: string; title: string; description?: string }[]
    >();

    for (const button of buttons) {
      const sectionTitle = button.sectionTitle ?? 'Categorías';
      const rows = sections.get(sectionTitle) ?? [];
      rows.push({
        id: button.payload,
        title: button.title,
        ...(button.description ? { description: button.description } : {})
      });
      sections.set(sectionTitle, rows);
    }

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
            button: actionButtonLabel ?? 'Ver categorias',
            sections: Array.from(sections.entries()).map(([title, rows]) => ({
              title,
              rows
            }))
          }
        };
console.log("payload", {
  messaging_product: 'whatsapp',
  to: normalizedTo,
  type: 'interactive',
  interactive
},)
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
