import type { customer } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const findOrCreateCustomer = async (
  businessId: string,
  phoneNumber: string,
  name?: string
): Promise<customer> => {
  return prisma.customer.upsert({
    where: {
      business_id_phone_number: {
        business_id: businessId,
        phone_number: phoneNumber
      }
    },
    update: {
      name: name ?? undefined
    },
    create: {
      business_id: businessId,
      phone_number: phoneNumber,
      name: name ?? undefined
    }
  });
};

export const findCustomerById = async (customerId: string): Promise<customer | null> => {
  return prisma.customer.findUnique({
    where: { id: customerId }
  });
};
