import { prisma } from "../lib/prisma";

export const refreshDraftOrderTimeout = async (
    draftOrderId: string
  ) => {
  
    const expiresAt = new Date(Date.now() + 15 * 60000);
  
    await prisma.draft_order.update({
      where: { id: draftOrderId },
      data: {
        expires_at: expiresAt,
        reminder_sent_at: null
      }
    });
  
  };