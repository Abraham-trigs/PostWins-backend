import { IntakeService } from "../../intake/intake.service";
import { PostWinRoutingService } from "./postwin-routing.service";
import { VerificationService } from "../../verification/verification.service";
export declare class PostaMockEngine {
    private intake;
    private router;
    private verifier;
    constructor(intake: IntakeService, router: PostWinRoutingService, verifier: VerificationService);
    runSimulation(): Promise<void>;
}
//# sourceMappingURL=mock-engine.d.ts.map