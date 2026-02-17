import { prisma } from "@/lib/prisma";

export class ExecutionProgressService {
  async getProgress(executionId: string) {
    const milestones = await prisma.executionMilestone.findMany({
      where: { executionId },
      select: {
        weight: true,
        completedAt: true,
      },
    });

    if (milestones.length === 0) {
      return {
        percent: 0,
        completed: 0,
        total: 0,
      };
    }

    const totalWeight = milestones.reduce((sum, m) => sum + m.weight, 0);

    const completedWeight = milestones
      .filter((m) => m.completedAt !== null)
      .reduce((sum, m) => sum + m.weight, 0);

    const percent = Math.round((completedWeight / totalWeight) * 100);

    return {
      percent,
      completedWeight,
      totalWeight,
    };
  }
}
