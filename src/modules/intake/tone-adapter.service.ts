import { PostWin, PostaContext } from "@posta/core";

export class ToneAdapterService {
  /**
   * Section G.3: Adapts outcome explanations to user context
   * Section C: Generates respectful, neutral descriptions
   */
  public adaptOutcome(postWin: PostWin, context: PostaContext): string {
    const { routingStatus, verificationStatus } = postWin;

    // Use implicit role detection to decide the complexity of the explanation
    if (context.role === 'NGO_PARTNER') {
      return `PostWin ${postWin.id} is ${routingStatus} and ${verificationStatus} against SDG 4 targets.`;
    }

    // Section G.2: Explain outcomes simply for beneficiaries only when asked
    if (routingStatus === 'MATCHED') {
      return "A local partner has been found to support this request. They will contact you soon.";
    }

    if (routingStatus === 'FALLBACK') {
      return "Your request is being reviewed by our central support team to find the best way to help.";
    }

    if (verificationStatus === 'FLAGGED') {
      return "We are currently checking the details of this request to ensure everything is correct.";
    }

    return "Your request is moving through the system safely.";
  }
}
