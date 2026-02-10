// modules/routing/acceptCase.service.ts
export async function acceptCase(params: {
  tenantId: string;
  caseId: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.caseAssignment.findUniqueOrThrow({
      where: { caseId: params.caseId },
      include: { executionBody: true },
    });

    // membership check here (non-negotiable)

    await transitionCaseLifecycleWithLedger({
      tenantId: params.tenantId,
      caseId: params.caseId,
      target: CaseLifecycle.ACCEPTED,
      actor: {
        kind: "HUMAN",
        userId: params.userId,
        authorityProof: "EXECUTION_BODY_ACCEPTANCE",
      },
    });

    await commitLedgerEvent(tx, {
      tenantId: params.tenantId,
      caseId: params.caseId,
      eventType: LedgerEventType.CASE_ACCEPTED,
      actor: {
        kind: "HUMAN",
        userId: params.userId,
        authorityProof: "EXECUTION_BODY_ACCEPTANCE",
      },
      payload: {
        executionBodyId: assignment.executionBodyId,
      },
    });
  });
}
