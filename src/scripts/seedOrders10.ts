/**
 * Inserta 10 órdenes de ejemplo para el negocio configurado, usando solo
 * `menu_item` cuyos ids están en `./data/menu_item_ids.json` (export del menú).
 *
 * Requisitos: business, currency, y que esos ids existan en `menu_item` para ese `business_id`.
 *
 *   npm run seed:orders
 *
 *   SEED_BUSINESS_ID=... npx ts-node -r dotenv/config src/scripts/seedOrders10.ts
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import seedMenuItemIds from "./data/menu_item_ids.json";

const DEFAULT_BUSINESS_ID =
  process.env.SEED_BUSINESS_ID ??
  "e89dfb88-a409-4818-a01e-37d7d5ba2e11";

const STATUSES = [
  "draft",
  "confirmed",
  "PENDING",
  "preparing",
  "delivered",
  "cancelled",
  "draft",
  "confirmed",
  "PENDING",
  "preparing"
] as const;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function main() {
  const businessId = DEFAULT_BUSINESS_ID;
  const allowedIds = seedMenuItemIds as string[];

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, currency_code: true }
  });
  if (!business) {
    throw new Error(`No existe business id=${businessId}`);
  }

  const currencyCode = business.currency_code ?? "ARS";
  const currency = await prisma.currency.findUnique({
    where: { code: currencyCode }
  });
  if (!currency) {
    throw new Error(
      `No existe currency code=${currencyCode}. Creá la fila en tabla currency o asigná currency_code al negocio.`
    );
  }

  const menuItems = await prisma.menu_item.findMany({
    where: {
      business_id: businessId,
      id: { in: allowedIds },
      is_available: true
    },
    include: {
      menu_item_price: {
        where: { is_active: true },
        orderBy: { valid_from: "desc" },
        take: 1
      }
    }
  });

  if (menuItems.length === 0) {
    throw new Error(
      `Ningún menu_item del JSON existe para business_id=${businessId}. Revisá ids o importá el menú.`
    );
  }

  if (menuItems.length < allowedIds.length) {
    console.warn(
      `Aviso: solo ${menuItems.length}/${allowedIds.length} ids del JSON existen en la BD; se usan esos.`
    );
  }

  const createdIds: string[] = [];

  for (let i = 0; i < 10; i++) {
    const phone = `5493415${String(100000 + i).padStart(6, "0")}`;

    const customer = await prisma.customer.upsert({
      where: {
        business_id_phone_number: {
          business_id: businessId,
          phone_number: phone
        }
      },
      create: {
        business_id: businessId,
        phone_number: phone,
        name: `Cliente seed ${i + 1}`
      },
      update: {}
    });

    const nLines = 1 + Math.floor(Math.random() * 3);
    const lines: {
      menu_item_id: string;
      quantity: number;
      unit_price: Prisma.Decimal;
    }[] = [];

    let subtotal = 0;
    for (let l = 0; l < nLines; l++) {
      const mi = pick(menuItems);
      const priceRow = mi.menu_item_price[0];
      const unit =
        priceRow?.amount != null
          ? Number(priceRow.amount)
          : 1000 + Math.floor(Math.random() * 4000);
      const qty = 1 + Math.floor(Math.random() * 2);
      subtotal += unit * qty;
      lines.push({
        menu_item_id: mi.id,
        quantity: qty,
        unit_price: new Prisma.Decimal(unit.toFixed(2))
      });
    }

    const createdAt = new Date(
      Date.now() - (9 - i) * 36 * 60 * 60 * 1000
    );

    const order = await prisma.orders.create({
      data: {
        business_id: businessId,
        customer_id: customer.id,
        conversation_id: null,
        status: STATUSES[i],
        currency_code: currencyCode,
        total_amount: new Prisma.Decimal(subtotal.toFixed(2)),
        created_at: createdAt,
        delivery_address_snapshot: Prisma.JsonNull,
        order_item: {
          create: lines.map((line) => ({
            menu_item_id: line.menu_item_id,
            quantity: line.quantity,
            unit_price: line.unit_price,
            serves_people: null
          }))
        }
      }
    });

    createdIds.push(order.id);
  }

  console.log("Órdenes creadas:", createdIds.length);
  console.log(createdIds.join("\n"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
