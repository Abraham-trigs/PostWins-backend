import { Request, Response } from "express";
/**
 * ============================================================================
 * NEW: Delivery intake (for NGO ops / field team)
 * POST /api/intake/delivery
 * Writes to timeline ledger: type=DELIVERY_RECORDED
 * ============================================================================
 */
export declare const handleIntakeDelivery: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * ============================================================================
 * NEW: Follow-up intake (field return visit / check-in)
 * POST /api/intake/followup
 * Writes to timeline ledger: type=FOLLOWUP_RECORDED
 * ============================================================================
 */
export declare const handleIntakeFollowup: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * ============================================================================
 * EXISTING: Beneficiary message intake (unchanged)
 * POST /api/intake  (legacy)
 * ============================================================================
 */
export declare const handleIntake: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=intake.controller.d.ts.map