export function isVerificationTimedOut(params: {
  createdAt: Date;
  now?: Date;
  timeoutMs: number;
}): boolean {
  const now = params.now ?? new Date();
  return now.getTime() - params.createdAt.getTime() >= params.timeoutMs;
}
