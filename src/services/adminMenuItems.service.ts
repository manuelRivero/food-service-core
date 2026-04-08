import { MenuCategoryTag, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type ListAdminMenuItemsParams = {
  businessId: string;
  page: number;
  pageSize: number;
  categoryId?: string;
  q?: string;
  includeUnavailable?: boolean;
};

export async function listAdminMenuItems(params: ListAdminMenuItemsParams) {
  const where: Prisma.menu_itemWhereInput = {
    business_id: params.businessId
  };

  if (!params.includeUnavailable) {
    where.is_available = true;
  }

  if (params.categoryId) {
    where.category_id = params.categoryId;
  }

  if (params.q?.trim()) {
    const query = params.q.trim();
    where.OR = [
      { name: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
      { ingredients: { contains: query, mode: "insensitive" } }
    ];
  }

  const skip = (params.page - 1) * params.pageSize;
  const [total, rows] = await prisma.$transaction([
    prisma.menu_item.count({ where }),
    prisma.menu_item.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take: params.pageSize,
      include: {
        menu_category: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })
  ]);

  return {
    items: rows.map((row) => ({
      ...row,
      categoryName: row.menu_category?.name ?? null
    })),
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / params.pageSize)
  };
}

export async function listAdminMenuCategoriesOptions(params: {
  businessId: string;
}) {
  const rows = await prisma.menu_category.findMany({
    where: {
      business_id: params.businessId
    },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      category_tag: true
    }
  });

  const SECTION_LABEL: Record<MenuCategoryTag, string> = {
    STARTER: "Entradas",
    MAIN: "Platos fuertes",
    SIDE: "Guarniciones",
    DRINK: "Bebidas",
    DESSERT: "Postres",
    OTHER: "Otros"
  };

  const uniqueTags = Array.from(new Set(rows.map((row) => row.category_tag)));

  return uniqueTags.map((tag) => ({
    id: tag,
    name: SECTION_LABEL[tag]
  }));
}

export async function createAdminMenuItem(params: {
  businessId: string;
  categoryId: string;
  name: string;
  description?: string | null;
  ingredients?: string | null;
  preparation?: string | null;
  servesPeople?: number | null;
  isFeatured?: boolean;
  image?: string | null;
  isAvailable?: boolean;
}) {
  const category = await prisma.menu_category.findFirst({
    where: {
      id: params.categoryId,
      business_id: params.businessId
    },
    select: { id: true }
  });
  if (!category) {
    throw new Error("CATEGORY_NOT_FOUND");
  }

  return prisma.menu_item.create({
    data: {
      business_id: params.businessId,
      category_id: params.categoryId,
      name: params.name,
      description: params.description ?? null,
      ingredients: params.ingredients ?? null,
      preparation: params.preparation ?? null,
      serves_people: params.servesPeople ?? null,
      is_featured: params.isFeatured ?? false,
      image: params.image ?? null,
      is_available: params.isAvailable ?? true
    }
  });
}

export async function updateAdminMenuItem(params: {
  businessId: string;
  id: string;
  categoryId?: string;
  name?: string;
  description?: string | null;
  ingredients?: string | null;
  preparation?: string | null;
  servesPeople?: number | null;
  isFeatured?: boolean;
  image?: string | null;
  isAvailable?: boolean;
}) {
  const existing = await prisma.menu_item.findFirst({
    where: {
      id: params.id,
      business_id: params.businessId
    },
    select: { id: true }
  });
  if (!existing) {
    return null;
  }

  if (params.categoryId) {
    const category = await prisma.menu_category.findFirst({
      where: {
        id: params.categoryId,
        business_id: params.businessId
      },
      select: { id: true }
    });
    if (!category) {
      throw new Error("CATEGORY_NOT_FOUND");
    }
  }

  return prisma.menu_item.update({
    where: { id: params.id },
    data: {
      ...(params.categoryId !== undefined ? { category_id: params.categoryId } : {}),
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.description !== undefined ? { description: params.description } : {}),
      ...(params.ingredients !== undefined ? { ingredients: params.ingredients } : {}),
      ...(params.preparation !== undefined ? { preparation: params.preparation } : {}),
      ...(params.servesPeople !== undefined ? { serves_people: params.servesPeople } : {}),
      ...(params.isFeatured !== undefined ? { is_featured: params.isFeatured } : {}),
      ...(params.image !== undefined ? { image: params.image } : {}),
      ...(params.isAvailable !== undefined ? { is_available: params.isAvailable } : {})
    }
  });
}

/** Eliminación segura: soft delete vía `is_available = false`. */
export async function deleteAdminMenuItem(params: {
  businessId: string;
  id: string;
}) {
  const existing = await prisma.menu_item.findFirst({
    where: {
      id: params.id,
      business_id: params.businessId
    },
    select: { id: true }
  });
  if (!existing) {
    return null;
  }

  return prisma.menu_item.update({
    where: { id: params.id },
    data: { is_available: false }
  });
}
