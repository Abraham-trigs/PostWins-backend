// apps/backend/src/modules/intake/validators/intake.bootstrap.schema.ts
// Purpose: Validate intake bootstrap request payload

import { z } from "zod";

export const IntakeBootstrapBodySchema = z.object({
  narrative: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 10, "Minimum 10 characters"),

  // 🚀 UPDATED: Removed UUID_RE transform to allow JSON strings for new profiles
  beneficiaryId: z.string().nullable().optional(),

  category: z.string().optional(), // Tightened from 'any' to 'string'
  location: z.string().optional(), // Tightened from 'any' to 'string'
  language: z.string().optional().default("en"),
  sdgGoals: z.array(z.string()).optional().default([]),

  autoRoute: z.boolean().optional().default(true),
});

/* =============================================================================
Design reasoning
------------------------------------------------------------------------------
The beneficiaryId now acts as a polymorphic field:
1. Valid UUID (Existing Beneficiary)
2. JSON String (New Beneficiary Profile: {displayName, phone})

The controller handles the logic of branching between these two states.
============================================================================= */
