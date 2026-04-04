import type { MenuCategoryTag } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { findOrCreateConversationState, updateConversationState } from '../repositories';
import type { ConversationMetadata } from './productQuery/types';
import {
  buildMetadataValue,
  getRequestedPartySize,
  normalizeMetadata,
} from './productQuery/utils';

/** Por unidad sin dato de ficha: 1 porción por unidad. */
const SERVES_FALLBACK = 1;

export type PortionCoverageResult = {
  coveredPortions: number;
  peopleCount: number | null;
  missingPortions: number | null;
  mainCoveredPortions: number;
  hasMainLine: boolean;
};

type DraftLineForCoverage = {
  quantity: number;
  menu_item: {
    serves_people: number | null;
    menu_category: { category_tag: MenuCategoryTag } | null;
  } | null;
};

export function linePortionCoverage(
  quantity: number,
  servesPeople: number | null | undefined
): number {
  const serves =
    servesPeople != null && servesPeople > 0 ? servesPeople : SERVES_FALLBACK;
  return quantity * serves;
}

export function computePortionCoverageFromDraftLines(
  lines: DraftLineForCoverage[]
): Omit<PortionCoverageResult, 'peopleCount' | 'missingPortions'> {
  let coveredPortions = 0;
  let mainCoveredPortions = 0;
  let hasMainLine = false;

  for (const line of lines) {
    const mi = line.menu_item;
    if (!mi) continue;
    const cov = linePortionCoverage(line.quantity, mi.serves_people);
    coveredPortions += cov;
    const tag = mi.menu_category?.category_tag;
    if (tag === 'MAIN') {
      hasMainLine = true;
      mainCoveredPortions += cov;
    }
  }

  return {
    coveredPortions,
    mainCoveredPortions,
    hasMainLine,
  };
}

function applyPeopleCount(
  base: Omit<PortionCoverageResult, 'peopleCount' | 'missingPortions'>,
  peopleCount: number | undefined
): PortionCoverageResult {
  const people =
    peopleCount != null && peopleCount > 0 ? peopleCount : null;
  const missingPortions =
    people != null ? Math.max(0, people - base.coveredPortions) : null;
  return {
    ...base,
    peopleCount: people,
    missingPortions,
  };
}

function pickDeterministicNextStep(r: PortionCoverageResult): string | null {
  const people = r.peopleCount;
  const needsMain =
    (people != null && people > 0 && r.mainCoveredPortions < people) ||
    (people == null && !r.hasMainLine);

  if (needsMain) {
    return 'Siguiente paso: elegí un plato principal.';
  }

  if (people != null && r.missingPortions != null) {
    if (r.missingPortions >= 1 && r.missingPortions <= 2) {
      return 'Estás cerca: podés finalizar el pedido o seguir sumando.';
    }
    if (r.missingPortions === 0) {
      return 'Podés sumar bebidas o guarniciones, o finalizar el pedido.';
    }
  }

  if (people == null && r.hasMainLine) {
    return 'Podés sumar bebidas o guarniciones.';
  }

  if (people != null && r.missingPortions != null && r.missingPortions > 2) {
    return 'Podés sumar bebidas o guarniciones mientras completás las porciones.';
  }

  return null;
}

/**
 * Texto guiado para carrito / post–agregar ítem (sin LLM).
 */
export function formatCartGuidanceBlock(result: PortionCoverageResult): string {
  const lines: string[] = [];
  const y = result.peopleCount;

  if (y != null && y > 0) {
    lines.push(`Porciones cubiertas: ${result.coveredPortions} de ${y}`);
    if (result.missingPortions != null) {
      if (result.coveredPortions < y) {
        lines.push(`Te faltan ${result.missingPortions} porciones.`);
      } else {
        lines.push('Ya cubriste la cantidad de personas.');
      }
    }
  } else {
    lines.push(`Porciones en carrito: ${result.coveredPortions}`);
  }

  const hint = pickDeterministicNextStep(result);
  if (hint) {
    lines.push('', hint);
  }

  return lines.join('\n');
}

/**
 * Lee el borrador activo, calcula porciones y persiste `coveredPortions` / `missingPortions` en metadata.
 */
export async function syncOrderCoverageToConversationState(
  conversationId: string,
  businessId: string,
  customerPhone: string
): Promise<PortionCoverageResult> {
  const state = await findOrCreateConversationState(conversationId);
  const meta = normalizeMetadata(state.metadata) as ConversationMetadata;
  const people = getRequestedPartySize(meta);

  const draft = await prisma.draft_order.findFirst({
    where: {
      business_id: businessId,
      customer_phone: customerPhone,
      status: 'active',
    },
    include: {
      draft_order_item: {
        include: {
          menu_item: {
            include: {
              menu_category: { select: { category_tag: true } },
            },
          },
        },
      },
    },
  });

  const empty = !draft?.draft_order_item?.length;
  const base = empty
    ? {
        coveredPortions: 0,
        mainCoveredPortions: 0,
        hasMainLine: false,
      }
    : computePortionCoverageFromDraftLines(draft.draft_order_item);

  const result = applyPeopleCount(base, people);

  const nextMeta: ConversationMetadata = { ...meta };
  nextMeta.coveredPortions = result.coveredPortions;
  if (result.missingPortions != null) {
    nextMeta.missingPortions = result.missingPortions;
  } else {
    delete nextMeta.missingPortions;
  }

  await updateConversationState(conversationId, {
    metadata: buildMetadataValue(nextMeta),
  });

  return result;
}
