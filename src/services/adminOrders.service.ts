import type { Prisma } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { prisma } from "../lib/prisma";

dayjs.extend(utc);

const MENU_ITEM_SELECT = {
  id: true,
  business_id: true,
  category_id: true,
  name: true,
  description: true,
  ingredients: true,
  preparation: true,
  is_available: true,
  created_at: true,
  serves_people: true,
  is_featured: true,
  ingredients_notes: true,
  image: true
} as const;

const ORDER_INCLUDE = {
  customer: true,
  currency: true,
  customer_address: true,
  conversation: {
    select: {
      id: true,
      channel: true,
      status: true,
      started_at: true,
      last_message_at: true
    }
  },
  order_item: {
    include: {
      menu_item: { select: MENU_ITEM_SELECT }
    },
    orderBy: { created_at: "asc" as const }
  }
} satisfies Prisma.ordersInclude;

export type AdminOrderListInclude = typeof ORDER_INCLUDE;

function parseDateStart(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return dayjs.utc(s).startOf("day").toDate();
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error("INVALID_DATE_FROM");
  }
  return d;
}

function parseDateEnd(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return dayjs.utc(s).endOf("day").toDate();
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error("INVALID_DATE_TO");
  }
  return d;
}

export type ListAdminOrdersParams = {
  businessId: string;
  page: number;
  pageSize: number;
  orderId?: string;
  dateFrom?: string;
  dateTo?: string;
  customerPhone?: string;
};

export async function listAdminOrders(params: ListAdminOrdersParams) {
  const {
    businessId,
    page,
    pageSize,
    orderId,
    dateFrom,
    dateTo,
    customerPhone
  } = params;

  const where: Prisma.ordersWhereInput = {
    business_id: businessId
  };

  if (orderId) {
    where.id = orderId;
  }

  if (customerPhone?.trim()) {
    where.customer = {
      phone_number: { contains: customerPhone.trim() }
    };
  }

  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) {
      where.created_at.gte = parseDateStart(dateFrom);
    }
    if (dateTo) {
      where.created_at.lte = parseDateEnd(dateTo);
    }
  }

  const skip = (page - 1) * pageSize;

  const [total, rows] = await prisma.$transaction([
    prisma.orders.count({ where }),
    prisma.orders.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { created_at: "desc" },
      skip,
      take: pageSize
    })
  ]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    items: rows,
    total,
    page,
    pageSize,
    totalPages
  };
}

export async function getAdminOrderById(businessId: string, orderId: string) {
  const order = await prisma.orders.findFirst({
    where: {
      id: orderId,
      business_id: businessId
    },
    include: ORDER_INCLUDE
  });
  return order;
}
