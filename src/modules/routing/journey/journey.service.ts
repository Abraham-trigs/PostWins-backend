// apps/backend/src/modules/routing/journey.service.ts
// Stateless helper service.
// No lifecycle mutation.
// No in-memory persistence.
// No governance authority.

import { ExecutionBody, PostWin } from "@posta/core";

export class JourneyService {
  ////////////////////////////////////////////////////////////////
  // Capability Check
  ////////////////////////////////////////////////////////////////

  public isBodyCapable(body: ExecutionBody, postWin: PostWin): boolean {
    if (!postWin.sdgGoals?.length) return false;

    return postWin.sdgGoals.every((goal) => body.capabilities.includes(goal));
  }

  ////////////////////////////////////////////////////////////////
  // Proximity Calculation
  ////////////////////////////////////////////////////////////////

  public calculateProximity(body: ExecutionBody, postWin: PostWin): number {
    if (!postWin.location || !body.location) return Infinity;

    return Math.sqrt(
      Math.pow(body.location.lat - postWin.location.lat, 2) +
        Math.pow(body.location.lng - postWin.location.lng, 2),
    );
  }

  ////////////////////////////////////////////////////////////////
  // Deterministic Ranking
  ////////////////////////////////////////////////////////////////

  public rankBodies(
    postWin: PostWin,
    availableBodies: ExecutionBody[],
  ): ExecutionBody[] {
    const capable = availableBodies.filter((b) =>
      this.isBodyCapable(b, postWin),
    );

    return capable.sort(
      (a, b) =>
        this.calculateProximity(a, postWin) -
        this.calculateProximity(b, postWin),
    );
  }
}
