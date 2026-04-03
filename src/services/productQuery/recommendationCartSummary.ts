import { prisma } from '../../lib/prisma';

/** Totales de unidades por rol de categoría (para contexto del recomendador). */
export type RecommendationCartSummary = {
  starters: number;
  mains: number;
  drinks: number;
  desserts: number;
};

const emptySummary = (): RecommendationCartSummary => ({
  starters: 0,
  mains: 0,
  drinks: 0,
  desserts: 0,
});

/**
 * Agrega cantidades del borrador por `menu_category.category_tag`.
 * OTHER y SIDE no suman a estos cuatro buckets.
 */
export async function buildRecommendationCartSummary(params: {
  businessId: string;
  customerPhone: string;
}): Promise<RecommendationCartSummary> {
  const draft = await prisma.draft_order.findFirst({
    where: {
      business_id: params.businessId,
      customer_phone: params.customerPhone,
      status: 'active',
    },
    select: { id: true },
  });

  if (!draft) {
    return emptySummary();
  }

  const lines = await prisma.draft_order_item.findMany({
    where: {
      draft_order_id: draft.id,
      product_id: { not: null },
    },
    select: {
      quantity: true,
      menu_item: {
        select: {
          menu_category: { select: { category_tag: true } },
        },
      },
    },
  });

  const acc = emptySummary();
  for (const line of lines) {
    const tag = line.menu_item?.menu_category?.category_tag;
    const q = line.quantity;
    if (q <= 0) continue;
    switch (tag) {
      case 'STARTER':
        acc.starters += q;
        break;
      case 'MAIN':
        acc.mains += q;
        break;
      case 'DRINK':
        acc.drinks += q;
        break;
      case 'DESSERT':
        acc.desserts += q;
        break;
      default:
        break;
    }
  }
  return acc;
}
