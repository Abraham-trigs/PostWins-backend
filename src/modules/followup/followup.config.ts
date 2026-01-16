export const followupConfig = {
  checkIntervalHours: 24,
  maxAttempts: 3,
  retryDelayHours: 48,
  timezone: "Africa/Accra",
  email: {
    provider: "sendgrid",
    apiKey: process.env.SENDGRID_API_KEY ?? "",
    from: process.env.FOLLOWUP_FROM ?? "noreply@postwins.com",
  },
} as const;
