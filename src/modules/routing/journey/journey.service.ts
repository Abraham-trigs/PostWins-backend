import { ExecutionBody, PostWin } from "@posta/core";

export class JourneyService {
  ////////////////////////////////////////////////////////////////
  // Capability Check
  ////////////////////////////////////////////////////////////////

  public isBodyCapable(body: ExecutionBody, postWin: PostWin): boolean {
    if (!postWin.sdgGoal) return false;

    return body.capabilities.includes(postWin.sdgGoal);
  }

  ////////////////////////////////////////////////////////////////
  // Proximity Calculation
  ////////////////////////////////////////////////////////////////

  public calculateProximity(body: ExecutionBody, postWin: PostWin): number {
    if (
      !postWin.location ||
      !body.location ||
      postWin.location.lat == null ||
      postWin.location.lng == null
    ) {
      return Infinity;
    }

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
