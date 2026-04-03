import {
  EnrichedContext,
  HandlerResult,
  IntentClassification,
  IntentHandler,
} from '../types';
import {
  interactiveResponse,
  listResponse,
  noResponse,
  textResponse,
} from '../utils';
import { ConversationIntent } from '../../../types/conversationIntent';
import { executeProductQuery } from '../../../services/productQuery';
import type { WhatsAppInteractiveMessage } from '../../../domain/intent/whatsappTemplates';
import { Prisma } from '@prisma/client';
import {
  findOrCreateConversationState,
  updateConversationState,
} from '../../../repositories/conversationState.repository';
import {
  buildMetadataValue,
  normalizeMetadata,
  partySizeMetadataFields,
  withoutLegacyPartyQuantity,
} from '../../../services/productQuery/utils';

export class ProductQueryHandler implements IntentHandler {
  readonly command = ConversationIntent.PRODUCT_QUERY;

  canHandle(intent: string): boolean {
    return intent === ConversationIntent.PRODUCT_QUERY;
  }

  async execute(
    ctx: EnrichedContext,
    classification?: IntentClassification
  ): Promise<HandlerResult | null> {
    const q = classification?.quantity;
    if (q != null && q > 0) {
      const state = await findOrCreateConversationState(ctx.conversation.id);
      const prev = withoutLegacyPartyQuantity(normalizeMetadata(state.metadata));
      await updateConversationState(ctx.conversation.id, {
        metadata: buildMetadataValue({
          ...prev,
          ...partySizeMetadataFields(q),
        }),
      } as Prisma.conversation_stateUpdateInput);
    }

    const result = await executeProductQuery(ctx, classification);
    if (result === null) return noResponse();
    if (typeof result === 'string') return textResponse(result);
    if (result.type === 'list') return listResponse(result);
    return interactiveResponse(result as WhatsAppInteractiveMessage);
  }
}
