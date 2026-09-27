import {
  AccountAlreadyExistsError,
  AlreadyMemberError,
  LastWorkspaceAdminError,
  MemberNotFoundError,
  WorkspaceNotFoundError,
  ProcedureConflictError,
  ProcedureLimitReachedError,
  ProcedureNotFoundError,
  InvalidInvitationError,
  InvalidMfaCodeError,
  InvitationNotRevocableError,
  MfaChallengeInvalidError,
  InvalidRecoveryError,
  AccountNotActiveError,
  NothingToRecoverError,
  SecondFactorRequiredError,
  UnknownAccountError,
  NoPendingEnrollmentError,
  NotAuthorizedError,
  ReauthenticationFailedError,
  TotpAlreadyEnabledError,
  TotpLockedError,
  TotpNotEnabledError,
} from '@vergissmeinnicht/application';
import { DomainValidationError } from '@vergissmeinnicht/domain';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/** A request body/params did not match the route schema. Carries no input values. */
export class InvalidRequestError extends Error {
  constructor() {
    super('Invalid request');
    this.name = 'InvalidRequestError';
  }
}

/**
 * Maps application errors to stable JSON error codes. Messages and inputs are never echoed;
 * unexpected errors are logged server-side and answered with a generic 500.
 */
export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof DomainValidationError) {
    return reply.code(400).send({ error: error.code, field: error.field });
  }
  if (error instanceof InvalidRequestError) return reply.code(400).send({ error: 'invalid_request' });
  if (error instanceof NotAuthorizedError) return reply.code(403).send({ error: 'forbidden' });
  if (error instanceof InvalidInvitationError) return reply.code(404).send({ error: 'invalid_invitation' });
  if (error instanceof InvitationNotRevocableError) return reply.code(409).send({ error: 'invitation_not_pending' });
  if (error instanceof AccountAlreadyExistsError) return reply.code(409).send({ error: 'account_exists' });
  if (error instanceof ReauthenticationFailedError) return reply.code(403).send({ error: 'reauthentication_failed' });
  if (error instanceof InvalidMfaCodeError) return reply.code(400).send({ error: 'invalid_code' });
  if (error instanceof MfaChallengeInvalidError) return reply.code(401).send({ error: 'mfa_challenge_invalid' });
  if (error instanceof TotpLockedError) return reply.code(429).send({ error: 'mfa_locked' });
  if (error instanceof TotpAlreadyEnabledError) return reply.code(409).send({ error: 'totp_already_enabled' });
  if (error instanceof TotpNotEnabledError) return reply.code(409).send({ error: 'totp_not_enabled' });
  if (error instanceof SecondFactorRequiredError) return reply.code(400).send({ error: 'second_factor_required' });
  if (error instanceof InvalidRecoveryError) return reply.code(404).send({ error: 'invalid_recovery' });
  if (error instanceof UnknownAccountError) return reply.code(404).send({ error: 'unknown_account' });
  if (error instanceof AccountNotActiveError) return reply.code(409).send({ error: 'account_not_active' });
  if (error instanceof NothingToRecoverError) return reply.code(409).send({ error: 'nothing_to_recover' });
  if (error instanceof NoPendingEnrollmentError) return reply.code(409).send({ error: 'no_pending_enrollment' });
  if (error instanceof WorkspaceNotFoundError) return reply.code(404).send({ error: 'workspace_not_found' });
  if (error instanceof MemberNotFoundError) return reply.code(404).send({ error: 'member_not_found' });
  if (error instanceof AlreadyMemberError) return reply.code(409).send({ error: 'already_member' });
  if (error instanceof ProcedureNotFoundError) return reply.code(404).send({ error: 'procedure_not_found' });
  if (error instanceof ProcedureConflictError) return reply.code(409).send({ error: 'procedure_conflict' });
  if (error instanceof ProcedureLimitReachedError) return reply.code(409).send({ error: 'procedure_limit_reached' });
  if (error instanceof LastWorkspaceAdminError) return reply.code(409).send({ error: 'last_workspace_admin' });

  const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (statusCode === 429) return reply.code(429).send({ error: 'rate_limited' });
  if (statusCode >= 400 && statusCode < 500) {
    // Body parsing, content-type and size errors from Fastify itself.
    return reply.code(statusCode).send({ error: 'invalid_request' });
  }
  // Messages can embed query parameters (e.g. Drizzle's "Failed query … params:"), which may hold
  // credential hashes or tokens: log the error type and stack frames only.
  const frames = error.stack?.split('\n').slice(1).join('\n');
  request.log.error({ err: { type: error.name, frames } }, 'unhandled error');
  return reply.code(500).send({ error: 'internal_error' });
}
