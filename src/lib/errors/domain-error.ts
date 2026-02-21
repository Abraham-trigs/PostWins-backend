// src/lib/errors/domain-error.ts

export abstract class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}
