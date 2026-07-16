/**
 * Structured application errors.
 *
 * `message` is developer-facing and may be logged. `safeMessage` is the only text
 * that may be returned to a caller: it must never contain secrets, SQL, internal
 * paths, or tenant data belonging to anyone.
 */

export type ErrorCode =
  | 'ENV_INVALID'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  ENV_INVALID: 500,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  public override readonly name = 'AppError';
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly safeMessage: string;

  constructor(code: ErrorCode, message: string, safeMessage?: string) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.safeMessage = safeMessage ?? defaultSafeMessage(code);
  }
}

function defaultSafeMessage(code: ErrorCode): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'The requested resource was not found.';
    case 'FORBIDDEN':
      return 'You do not have permission to perform this action.';
    case 'UNAUTHENTICATED':
      return 'Authentication is required.';
    case 'VALIDATION_FAILED':
      return 'The submitted data is not valid.';
    case 'CONFLICT':
      return 'The request conflicts with the current state.';
    case 'ENV_INVALID':
    case 'INTERNAL':
      return 'An unexpected error occurred.';
  }
}
