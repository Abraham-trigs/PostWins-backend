import { Request, Response } from "express";
import { requireIdempotencyMeta } from "../helpers/intake.helpers";
import { IntakeBootstrapBodySchema } from "../validators/intake.bootstrap.schema";
import { commitIdempotencyResponse } from "@/middleware/idempotency.middleware";
import { IntakeBootstrapService } from "../services/intake.bootstrap.service";

const bootstrapService = new IntakeBootstrapService();

export const handleIntakeBootstrap = async (req: Request, res: Response) => {
  let idempotencyKey: string | undefined;

  try {
    ////////////////////////////////////////////////////////////////
    // Idempotency metadata
    ////////////////////////////////////////////////////////////////

    const meta = requireIdempotencyMeta(res);
    idempotencyKey = meta.key;
    const requestHash = meta.requestHash;

    ////////////////////////////////////////////////////////////////
    // Input validation
    ////////////////////////////////////////////////////////////////

    const parsed = IntakeBootstrapBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.flatten().fieldErrors,
      });
    }

    ////////////////////////////////////////////////////////////////
    // Delegate full bootstrap to service
    ////////////////////////////////////////////////////////////////

    const responsePayload = await bootstrapService.bootstrap(
      req,
      parsed.data,
      idempotencyKey,
      requestHash,
    );

    ////////////////////////////////////////////////////////////////
    // Idempotency commit
    ////////////////////////////////////////////////////////////////

    if (idempotencyKey) {
      await commitIdempotencyResponse(res, responsePayload);
    }

    return res.status(201).json(responsePayload);
  } catch (error: any) {
    console.error("❌ BOOTSTRAP_ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: error.message ?? "BOOTSTRAP_FAILED",
      flags: error.flags ?? [],
    });
  }
};
