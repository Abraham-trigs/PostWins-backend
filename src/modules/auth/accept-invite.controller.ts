// apps/backend/src/modules/auth/accept-invite.controller.ts
// Purpose: Accept invite token → create user → assign role → create session

///////////////////////////////////////////////////////////////////////////////////////////////////
// Design reasoning
///////////////////////////////////////////////////////////////////////////////////////////////////
// - This is the ONLY place where new users may be created.
// - Invite token must be valid, unexpired, and tenant-scoped.
// - Role must exist in tenant.
// - Operation must be atomic (transaction).
// - Invite token is deleted after use.
// - Session issued only after identity is finalized.

///////////////////////////////////////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Zod validation
// - Token hash lookup
// - Transactional identity creation
// - Idempotent role assignment
// - Session issuance
// - Cookie delivery

///////////////////////////////////////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Invite token hashing prevents DB token leaks.
// - Transaction guarantees no partial user creation.
// - Idempotency prevents duplicate accounts under race conditions.
// - Identity provisioning remains governance-bound.
///////////////////////////////////////////////////////////////////////////////////////////////////

import { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";

const AcceptSchema = z.object({
  token: z.string().min(10),
  name: z.string().min(1),
});

const ACCESS_TTL = "15m";
const REFRESH_DAYS = 7;

export async function acceptInvite(req: Request, res: Response) {
  try {
    const { token, name } = AcceptSchema.parse(req.body);

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invite = await prisma.inviteToken.findUnique({
      where: { tokenHash },
    });

    if (!invite) {
      return res.status(400).json({ ok: false, error: "Invalid invite token" });
    }

    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ ok: false, error: "Invite expired" });
    }

    const result = await prisma.$transaction(async (tx) => {
      ////////////////////////////////////////////////////////////////
      // 1️⃣ Ensure role exists
      ////////////////////////////////////////////////////////////////

      const role = await tx.role.findFirst({
        where: {
          tenantId: invite.tenantId,
          key: invite.roleKey,
        },
      });

      if (!role) {
        throw new Error("Role no longer valid");
      }

      ////////////////////////////////////////////////////////////////
      // 2️⃣ Check if user already exists (edge case protection)
      ////////////////////////////////////////////////////////////////

      let user = await tx.user.findFirst({
        where: {
          tenantId: invite.tenantId,
          email: invite.email,
        },
      });

      ////////////////////////////////////////////////////////////////
      // 3️⃣ Create user ONLY if not exists
      ////////////////////////////////////////////////////////////////

      if (!user) {
        user = await tx.user.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: invite.tenantId,
            email: invite.email,
            name,
            isActive: true,
          },
        });
      }

      ////////////////////////////////////////////////////////////////
      // 4️⃣ Ensure role attached
      ////////////////////////////////////////////////////////////////

      const existingUserRole = await tx.userRole.findFirst({
        where: {
          userId: user.id,
          roleId: role.id,
        },
      });

      if (!existingUserRole) {
        await tx.userRole.create({
          data: {
            id: crypto.randomUUID(),
            userId: user.id,
            roleId: role.id,
          },
        });
      }

      ////////////////////////////////////////////////////////////////
      // 5️⃣ Delete invite (single-use)
      ////////////////////////////////////////////////////////////////

      await tx.inviteToken.delete({
        where: { id: invite.id },
      });

      ////////////////////////////////////////////////////////////////
      // 6️⃣ Create session
      ////////////////////////////////////////////////////////////////

      const accessToken = jwt.sign(
        { userId: user.id, tenantId: user.tenantId },
        process.env.JWT_SECRET!,
        { expiresIn: ACCESS_TTL },
      );

      const refreshRaw = crypto.randomUUID();
      const refreshHash = crypto
        .createHash("sha256")
        .update(refreshRaw)
        .digest("hex");

      await tx.session.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          tenantId: user.tenantId,
          refreshTokenHash: refreshHash,
          expiresAt: new Date(Date.now() + REFRESH_DAYS * 86400000),
        },
      });

      return { accessToken, refreshRaw };
    });

    ////////////////////////////////////////////////////////////////
    // 7️⃣ Set cookies
    ////////////////////////////////////////////////////////////////

    res.cookie("session", result.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // set true in production
    });

    res.cookie("refresh", result.refreshRaw, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
}
