import { DetectedContext } from "./intake.types";

export async function detectContext(message: string): Promise<DetectedContext> {
  const msg = message.toLowerCase();

  let role: DetectedContext["role"] = "BENEFICIARY";

  if (
    msg.includes("partner") ||
    msg.includes("organization") ||
    msg.includes("ngo")
  ) {
    role = "NGO_PARTNER";
  }

  const words = message.trim().split(/\s+/);
  const avgWordLength = message.length / (words.length || 1);

  const literacyLevel =
    words.length < 6 || avgWordLength < 4 ? "LOW" : "STANDARD";

  return {
    role,
    isImplicit: true,
    literacyLevel,
  };
}
