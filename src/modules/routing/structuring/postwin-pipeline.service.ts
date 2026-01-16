// filepath: src/modules/routing/postwin-pipeline.service.ts
import { PostWin, ExecutionBody } from "@posta/core";
import { TaskService } from "./task.service";
import { JourneyService } from "./journey.service";
import { PostWinRoutingService } from "./postwin-routing.service";

export class PostWinPipelineService {
  constructor(
    private taskService: TaskService,
    private journeyService: JourneyService,
    private routingService: PostWinRoutingService
  ) {}

  /**
   * Complete intake → routing → verification pipeline
   * Includes fraud/integrity hooks
   */
  async intakeAndRoute(
    message: string,
    beneficiaryId: string,
    availableBodies: ExecutionBody[],
    partnerId?: string
  ): Promise<PostWin> {
    // 1. Process intake
    const partialPostWin = await this.taskService.processIntake(message, partnerId);
    partialPostWin.beneficiaryId = beneficiaryId;

    // Assign default task if none provided
    if (!partialPostWin.taskId) partialPostWin.taskId = 'ENROLL'; // default first SDG 4 task

    // 2. Pass through routing & execution logic (includes integrity checks)
    const fullPostWin = await this.routingService.processPostWin(
      partialPostWin as PostWin,
      availableBodies,
      partialPostWin.sdgGoals
    );

    return fullPostWin;
  }

  /**
   * Adds a verifier approval to a PostWin
   */
  addVerification(postWin: PostWin, verifierId: string, sdgGoal: string) {
    this.routingService.addVerifierApproval(postWin, verifierId, sdgGoal);
  }
}

/* Example usage:
(async () => {
  const taskService = new TaskService();
  const journeyService = new JourneyService();
  const routingService = new PostWinRoutingService(taskService, journeyService);
  const pipelineService = new PostWinPipelineService(taskService, journeyService, routingService);

  const availableBodies = [
    { id: 'ngo_1', capabilities: ['SDG_4'], location: { lat: 5.6, lng: -0.2 }, trustScore: 0.9 },
    { id: 'ngo_2', capabilities: ['SDG_4'], location: { lat: 5.7, lng: -0.25 }, trustScore: 0.85 },
  ];

  const postWin = await pipelineService.intakeAndRoute(
    "Learner completed literacy module",
    "beneficiary_123",
    availableBodies,
    "partner_456"
  );

  console.log(postWin);

  // Add verifier approval
  pipelineService.addVerification(postWin, "verifier_1", "SDG_4");
  pipelineService.addVerification(postWin, "verifier_2", "SDG_4");
  console.log(postWin.verificationRecords);
})();
*/
