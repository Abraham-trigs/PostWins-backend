export class CaseNotFoundError extends Error {
  constructor(message = "Case not found") {
    super(message);
    this.name = "CaseNotFoundError";
  }
}

export class CaseForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "CaseForbiddenError";
  }
}

export class ResolverError extends Error {
  constructor(message = "Invalid case reference") {
    super(message);
    this.name = "ResolverError";
  }
}
