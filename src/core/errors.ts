/** An error whose message is safe and useful to show to the model / user. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** A live upstream (geocoder, NOTAM feed, pack download) failed. */
export class UpstreamError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number
  ) {
    super(`${provider}: ${message}`);
    this.name = 'UpstreamError';
  }
}

export class PackUnavailableError extends UserFacingError {
  constructor(reason: string) {
    super(`Airspace data pack unavailable: ${reason}`);
    this.name = 'PackUnavailableError';
  }
}

export class PackIncompatibleError extends UserFacingError {
  constructor(found: number, expected: number) {
    super(`Airspace data pack schema version ${found} is not supported by this server (expects ${expected}). Update the server or the pack.`);
    this.name = 'PackIncompatibleError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
