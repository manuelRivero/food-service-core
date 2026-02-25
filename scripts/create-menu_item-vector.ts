import OpenAI from "openai";
import { prisma } from "../src/lib/prisma";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateEmbeddings() {
  const items = await prisma.menu_item.findMany();

  for (const item of items) {
    const text = `
    ${item.name}
    ${item.description ?? ""}
    ${item.ingredients ?? ""}
    `;

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text
    });

    const embedding = response.data[0].embedding;

    await prisma.$executeRaw`
      UPDATE menu_item
      SET embedding = ${embedding}::vector
      WHERE id = ${item.id}
    `;
  }
}

generateEmbeddings();