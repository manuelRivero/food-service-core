import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export type MenuButton = {
  title: string;
  payload: string;
};

export type MenuResponse = {
  text: string;
  buttons: MenuButton[];
};

export type ItemButton = {
  title: string;
  payload: string;
};

export type ItemResponse = {
  text: string;
  buttons: ItemButton[];
};

type MenuPrice = {
  amount: Prisma.Decimal;
  currency_code: string;
};

const formatPrice = (price: MenuPrice): string => {
  const amount = price.amount.toFixed(2);
  return `${amount} ${price.currency_code}`;
};

const buildPriceWhere = (currency: string | null, now: Date) => {
  const base = {
    is_active: true,
    valid_from: { lte: now },
    OR: [{ valid_to: null }, { valid_to: { gte: now } }]
  };

  if (!currency) {
    return base;
  }

  return {
    ...base,
    currency_code: currency
  };
};

const toButtonTitle = (value: string): string => value.slice(0, 20);

export class MenuService {
  static async getMenuForCustomer(params: {
    businessId: string;
    customerId: string;
  }): Promise<MenuResponse> {
    const { customerId } = params;
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { preferred_currency: true }
    });

    const currency = customer?.preferred_currency ?? null;
    const lines: string[] = [
      '🍽️ Menú peruano',
      '',
      'Descubre entradas, platos fuertes, marinos, bebidas, postres y vinos.',
      'Presiona el botón para ver las categorías disponibles.'
    ];

    if (!currency) {
      lines.push('', 'ℹ️ No tengo tu moneda preferida, los precios pueden omitirse.');
    }

    const buttons: MenuButton[] = [
      {
        title: 'Ver categorías',
        payload: 'VIEW_CATEGORIES'
      }
    ];

    return {
      text: lines.join('\n'),
      buttons
    };
  }

  static async getCategoryListForCustomer(params: {
    businessId: string;
    customerId: string;
  }): Promise<MenuResponse> {
    const { businessId, customerId } = params;
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { preferred_currency: true }
    });

    const currency = customer?.preferred_currency ?? null;
    const now = new Date();
    const priceWhere = buildPriceWhere(currency, now);

    const categories = await prisma.menu_category.findMany({
      where: {
        business_id: businessId,
        is_active: true
      },
      orderBy: { position: 'asc' },
      include: {
        menu_item: {
          where: {
            is_available: true,
            menu_item_price: {
              some: priceWhere
            }
          },
          select: { id: true }
        }
      }
    });

    const visibleCategories = categories.filter(
      (category) => category.menu_item.length > 0
    );

    const lines: string[] = ['📋 Categorías disponibles', '', 'Selecciona una categoría.'];

    if (visibleCategories.length === 0) {
      return {
        text: 'No hay categorías disponibles en este momento.',
        buttons: []
      };
    }

    const buttons: MenuButton[] = visibleCategories.map((category) => ({
      title: toButtonTitle(category.name),
      payload: `CATEGORY:${category.id}`
    }));

    return {
      text: lines.join('\n'),
      buttons
    };
  }

  static async getItemsByCategory(params: {
    businessId: string;
    customerId: string;
    categoryId: string;
  }): Promise<ItemResponse> {
    const { businessId, customerId, categoryId } = params;

    const [business, customer] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }),
      prisma.customer.findUnique({
        where: { id: customerId },
        select: { preferred_currency: true }
      })
    ]);

    if (!business) {
      throw new Error('Business no encontrado');
    }
    if (!customer) {
      throw new Error('Customer no encontrado');
    }

    const currency = customer.preferred_currency ?? null;
    if (!currency) {
      return {
        text: 'No tengo tu moneda preferida registrada. Por favor indícala para mostrar precios.',
        buttons: [{ title: 'Volver a categorías', payload: 'VIEW_MENU' }]
      };
    }

    const now = new Date();
    const priceWhere = buildPriceWhere(currency, now);

    const items = await prisma.menu_item.findMany({
      where: {
        business_id: businessId,
        category_id: categoryId,
        is_available: true,
        menu_item_price: {
          some: priceWhere
        }
      },
      orderBy: { created_at: 'asc' },
      include: {
        menu_item_price: {
          where: priceWhere,
          orderBy: { valid_from: 'desc' },
          take: 1
        }
      }
    });

    if (items.length === 0) {
      return {
        text: 'No hay productos disponibles en esta categoría.',
        buttons: [{ title: 'Volver a categorías', payload: 'VIEW_MENU' }]
      };
    }

    const lines: string[] = ['📝 Productos:'];
    items.forEach((item, idx) => {
      const price = item.menu_item_price[0];
      const priceText = price ? formatPrice(price) : 'N/A';
      lines.push(`${idx + 1}) ${item.name} - ${priceText}`);
    });

    const buttons: ItemButton[] = items.slice(0, 3).map((item) => ({
      title: toButtonTitle(`Agregar: ${item.name}`),
      payload: `ADD_ITEM_${item.id}`
    }));

    buttons.push({ title: 'Volver a categorías', payload: 'VIEW_MENU' });

    return {
      text: lines.join('\n'),
      buttons
    };
  }
}
