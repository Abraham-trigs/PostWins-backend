// apps/backend/src/types/express.d.ts

export {};

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        tenantId: string;
        email?: string;
        roles?: string[];
      };
    }
  }
}
