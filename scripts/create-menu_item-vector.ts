import OpenAI from "openai";
import { prisma } from "../src/lib/prisma";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateEmbeddings() {
  const now = new Date();
  const items = await prisma.menu_item.findMany({
    include: {
      menu_category: {
        select: {
          name: true,
          description: true
        }
      },
      menu_item_price: {
        where: {
          is_active: true,
          valid_from: { lte: now },
          OR: [{ valid_to: null }, { valid_to: { gte: now } }]
        },
        orderBy: { valid_from: "desc" },
        take: 1
      }
    }
  });

  for (const item of items) {
    const activePrice = item.menu_item_price[0];
    const priceText = activePrice
      ? `${activePrice.amount.toString()} ${activePrice.currency_code}`
      : "";
    const text = `
    Nombre: ${item.name}
    Descripción: ${item.description ?? ""}
    Ingredientes: ${item.ingredients ?? ""}
    Sirve personas: ${item.serves_people ?? ""}
    Disponible: ${item.is_available ? "sí" : "no"}
    Imagen: ${item.image ?? ""}
    Categoría: ${item.menu_category?.name ?? ""}
    Categoría descripción: ${item.menu_category?.description ?? ""}
    Precio: ${priceText}
    `;

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text
    });

    const embedding = response.data[0].embedding;
    const embeddingString = `[${embedding.join(",")}]`;

    await prisma.$executeRaw`
      UPDATE menu_item
      SET embedding = ${embeddingString}::vector
      WHERE id = ${item.id}
    `;
  }
}

generateEmbeddings().catch(console.error);