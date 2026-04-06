import type { BusinessUserRole } from "./auth";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        businessId: string;
        role: BusinessUserRole;
      };
    }
  }
}

export {};
