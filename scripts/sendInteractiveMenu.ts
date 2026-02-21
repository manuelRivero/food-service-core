import 'dotenv/config';
import { WhatsAppSenderService } from '../src/services/whatsappSender.service';

const run = async (): Promise<void> => {
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID no está definida');
  }

  const sender = new WhatsAppSenderService();
  await sender.sendInteractiveMenu({
    phoneNumberId,
    to: '543413867990',
    text: 'Selecciona una categoría:',
    buttons: [
      { title: 'Pizzas', payload: 'VIEW_CATEGORY_PIZZAS' },
      { title: 'Burgers', payload: 'VIEW_CATEGORY_BURGERS' },
      { title: 'Bebidas', payload: 'VIEW_CATEGORY_BEBIDAS' }
    ]
  });
};

run().catch((error) => {
  console.error('Error enviando menú interactivo:', error);
  process.exit(1);
});
