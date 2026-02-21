import { prisma } from '../src/lib/prisma';

const run = async (): Promise<void> => {
  await prisma.$executeRawUnsafe(
    "CREATE UNIQUE INDEX IF NOT EXISTS conversation_open_customer_unique ON conversation (customer_id) WHERE status = 'open'"
  );
};

run()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error('Error creando indice unico parcial:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
