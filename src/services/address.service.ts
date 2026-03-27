import { HandlerResult } from '../controllers/webhook/types';
import { EnrichedContext } from '../controllers/webhook/types';
import { prisma } from '../lib/prisma';
import { updateConversationState } from '../repositories/conversationState.repository';


export class AddressService {
  

  async process(ctx: EnrichedContext): Promise<HandlerResult> {
    const step = ctx.conversationState?.metadata?.onboarding_step;

    if (!step) {
      return this.start(ctx);
    }

    switch (step) {
      case 'CAPTURE':
        return this.capture(ctx);

      case 'CONFIRM':
        return this.confirm(ctx);

      default:
        return this.start(ctx);
    }
  }

  // =========================
  // STEP: START
  // =========================
  private async start(ctx: EnrichedContext): Promise<HandlerResult> {
    await this.updateState(ctx, {
      onboarding_step: 'CAPTURE',
      onboarding_started_at: new Date().toISOString(),
    });

    return {
      content: {
        type: 'text',
        body: '📍 Para continuar, decime tu dirección o compartí tu ubicación.',
      },
      isInteractive: false,
    };
  }

  // =========================
  // STEP: CAPTURE
  // =========================
  private async capture(ctx: EnrichedContext): Promise<HandlerResult> {
    const message = ctx.message;

    if (this.isLocation(message)) {
      return this.handleLocation(ctx);
    }

    if (this.isText(message)) {
      return this.handleTextAddress(ctx);
    }

    return this.retry('No entendí el formato 😕');
  }

  private async handleTextAddress(
    ctx: EnrichedContext
  ): Promise<HandlerResult> {
    const text = ctx.message.text;

    const geo = await this.geocode(text);

    if (!geo) {
      return this.retry('No pude encontrar esa dirección 😕');
    }

    const zone = await this.getCoverage(geo.lat, geo.lng, ctx.business.id);

    if (!zone) {
      return this.outOfCoverage();
    }

    await this.updateState(ctx, {
      onboarding_step: 'CONFIRM',
      temp_address: geo.formatted,
      temp_lat: geo.lat,
      temp_lng: geo.lng,
      temp_zone_id: zone.id,
    });

    return {
      content: {
        type: 'interactive',
        body: `📍 Encontré esta dirección:\n${geo.formatted}\n\n¿Es correcta?`,
        buttons: ['Confirmar', 'Editar'],
      },
      isInteractive: true,
    };
  }

  private async handleLocation(
    ctx: EnrichedContext
  ): Promise<HandlerResult> {
    const { lat, lng } = ctx.message.location;

    const address = await this.reverseGeocode(lat, lng);

    const zone = await this.getCoverage(lat, lng, ctx.business?.id);

    if (!zone) {
      return this.outOfCoverage();
    }

    await this.updateState(ctx, {
      onboarding_step: 'CONFIRM',
      temp_address: address,
      temp_lat: lat,
      temp_lng: lng,
      temp_zone_id: zone.id,
    });

    return {
      content: {
        type: 'interactive',
        body: `📍 Detecté tu ubicación:\n${address}\n\n¿Es correcta?`,
        buttons: ['Confirmar', 'Editar'],
      },
      isInteractive: true,
    };
  }

  // =========================
  // STEP: CONFIRM
  // =========================
  private async confirm(ctx: EnrichedContext): Promise<HandlerResult> {
    const text = ctx.message?.text?.toLowerCase() || '';

    if (text.includes('confirmar')) {
      return this.saveAddress(ctx);
    }

    if (text.includes('editar')) {
      return this.edit(ctx);
    }

    return {
      content: {
        type: 'text',
        body: 'Por favor elegí una opción: Confirmar o Editar.',
      },
      isInteractive: false,
    };
  }

  private async saveAddress(ctx: EnrichedContext): Promise<HandlerResult> {
    const meta = ctx.conversationState.metadata;

    // Opcional: desmarcar otras direcciones como default
    await prisma.customer_address.updateMany({
      where: { customer_id: ctx.customer.id },
      data: { is_default: false },
    });

    await prisma.customer_address.create({
      data: {
        customer_id: ctx.customer.id,
          street_address: meta.temp_address,
        is_default: true,
      },
    });

    await this.clearState(ctx);

    return {
      content: {
        type: 'text',
        body: '✅ Dirección guardada correctamente.\n\n¿En qué te ayudo ahora?',
      },
      isInteractive: false,
    };
  }

  private async edit(ctx: EnrichedContext): Promise<HandlerResult> {
    await this.updateState(ctx, {
      onboarding_step: 'CAPTURE',
      temp_address: null,
      temp_lat: null,
      temp_lng: null,
      temp_zone_id: null,
    });

    return {
      content: {
        type: 'text',
        body: 'Perfecto, decime la dirección nuevamente 📍',
      },
      isInteractive: false,
    };
  }

  // =========================
  // HELPERS
  // =========================
  private isLocation(message: any): boolean {
    return !!message?.location;
  }

  private isText(message: any): boolean {
    return !!message?.text;
  }

  private async getCoverage(
    lat: number,
    lng: number,
    businessId: string
  ): Promise<any> {
    const result = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        id,
        name,
        delivery_fee,
        min_order_amount,
        estimated_delivery_minutes,
        priority
      FROM business_coverage_zone
      WHERE is_active = true
        AND business_id = '${businessId}'
        AND ST_Contains(
          coverage_area,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
        )
      ORDER BY priority DESC
      LIMIT 1;
    `);
  
    return result[0] || null;
  }

  private async updateState(ctx: EnrichedContext, data: any) {
    await updateConversationState(ctx.conversationId, {
      metadata: {
        ...ctx.conversationState.metadata,
        ...data,
      },
    });
  }

  private async clearState(ctx: EnrichedContext) {
    await updateConversationState(ctx.conversationId, {
      metadata: {},
    });
  }

  private retry(message: string): HandlerResult {
    return {
      content: {
        type: 'text',
        body: `${message}\n\nProbá con otra dirección 🙏`,
      },
      isInteractive: false,
    };
  }

  private outOfCoverage(): HandlerResult {
    return {
      content: {
        type: 'text',
        body: '🚫 Lo siento, no tenemos cobertura en esa zona.\n\nProbá con otra dirección.',
      },
      isInteractive: false,
    };
  }

  // =========================
  // EXTERNAL SERVICES (MOCKS)
  // =========================

  private async geocode(
    address: string
  ): Promise<{ lat: number; lng: number; formatted: string } | null> {
    // TODO: integrar Google Maps / OSM + cache
    return {
      lat: -32.9442,
      lng: -60.6505,
      formatted: address,
    };
  }

  private async reverseGeocode(
    lat: number,
    lng: number
  ): Promise<string> {
    // TODO: integrar reverse geocoding real
    return `Ubicación (${lat}, ${lng})`;
  }
}
