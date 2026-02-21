import { MenuService } from '../src/services/menu.service';
import { WhatsAppSenderService } from '../src/services/whatsappSender.service';
import { findOrCreateCustomer } from '../src/repositories/customer.repository';
import { prisma } from '../src/lib/prisma';

const BUSINESS_ID = process.env.BUSINESS_ID ?? '';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
const TO = process.env.WHATSAPP_TEST_TO ?? '';

const assertEnv = (label: string, value: string): void => {
  if (!value) {
    throw new Error(`Falta configurar ${label} en el entorno.`);
  }
};

const buildCategoryListPages = (
  buttons: { title: string; payload: string; description?: string; sectionTitle?: string }[],
  pageSize = 10
): { buttons: typeof buttons; page: number; totalPages: number }[] => {
  const itemsPerPage = Math.max(pageSize - 2, 1);
  const totalPages = Math.ceil(buttons.length / itemsPerPage);
  const pages: { buttons: typeof buttons; page: number; totalPages: number }[] = [];

  for (let page = 1; page <= totalPages; page += 1) {
    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageButtons = buttons.slice(start, end);
    const prevPage = page - 1;
    const nextPage = page + 1;

    if (prevPage >= 1) {
      pageButtons.push({
        title: 'Pagina anterior',
        payload: `CATEGORY_LIST_PAGE:${prevPage}`,
        description: 'Regresar a la pagina anterior',
        sectionTitle: 'Categorías'
      });
    }

    if (nextPage <= totalPages) {
      const nextStart = (nextPage - 1) * itemsPerPage;
      const nextEnd = nextStart + itemsPerPage;
      const nextTitles = buttons
        .slice(nextStart, nextEnd)
        .map((button) => button.title)
        .join(', ');

      pageButtons.push({
        title: 'Ver mas categorias',
        payload: `CATEGORY_LIST_PAGE:${nextPage}`,
        description: nextTitles.slice(0, 72),
        sectionTitle: 'Categorías'
      });
    }

    pages.push({ buttons: pageButtons, page, totalPages });
  }

  return pages;
};

const main = async (): Promise<void> => {
  assertEnv('BUSINESS_ID', BUSINESS_ID);
  assertEnv('WHATSAPP_PHONE_NUMBER_ID', PHONE_NUMBER_ID);
  assertEnv('WHATSAPP_TEST_TO', TO);

  const customer = await findOrCreateCustomer(BUSINESS_ID, TO);
  const menuResponse = await MenuService.getMenuForCustomer({
    businessId: BUSINESS_ID,
    customerId: customer.id
  });

  const sender = new WhatsAppSenderService();

  if (menuResponse.buttons.length === 0) {
    await sender.sendTextMessage({
      phoneNumberId: PHONE_NUMBER_ID,
      to: TO,
      message: menuResponse.text
    });
    return;
  }

  const pages = buildCategoryListPages(menuResponse.buttons);
  const firstPage = pages[0];

  const pageText = menuResponse.text;

  await sender.sendInteractiveMenu({
    phoneNumberId: PHONE_NUMBER_ID,
    to: TO,
    text: pageText,
    buttons: firstPage?.buttons ?? [],
    forceList: true,
    page: firstPage && firstPage.totalPages > 1 ? 1 : undefined,
    totalPages: firstPage && firstPage.totalPages > 1 ? firstPage.totalPages : undefined
  });
};

main()
  .catch((error) => {
    console.error('Error enviando menu de prueba:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
