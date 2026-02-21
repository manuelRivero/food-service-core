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

  await sender.sendInteractiveMenu({
    phoneNumberId: PHONE_NUMBER_ID,
    to: TO,
    text: menuResponse.text,
    buttons: menuResponse.buttons
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
