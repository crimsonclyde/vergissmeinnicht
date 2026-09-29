import {
  AccountStatusUnchangedError,
  InvalidCursorError,
  SoleWorkspaceManagerError,
  KnotAlreadyRevokedError,
  KnotLimitReachedError,
  KnotNotFoundError,
  KnotRecordNotFoundError,
  KnotTargetNotFoundError,
  AccountAlreadyExistsError,
  AlreadyMemberError,
  LastWorkspaceAdminError,
  MemberNotFoundError,
  WorkspaceNotFoundError,
  ProcedureConflictError,
  ProcedureLimitReachedError,
  ProcedureNotFoundError,
  InvalidProcedureReferenceError,
  ProcedureHasNoStepsError,
  RunLimitReachedError,
  RunNotFoundError,
  RunNotActiveError,
  RunIncompleteError,
  RunStepNotFoundError,
  StepStateConflictError,
  OfflineAccountMismatchError,
  ScheduleClosedError,
  ScheduleConflictError,
  ScheduleLimitReachedError,
  ScheduleNotFoundError,
  ScheduledProcedureUnavailableError,
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
import { ProcedureImportError } from '@vergissmeinnicht/import-export';
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
  if (error instanceof InvalidCursorError) return reply.code(400).send({ error: 'invalid_cursor' });
  if (error instanceof ProcedureImportError) return reply.code(400).send({ error: error.code });
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
  if (error instanceof AccountStatusUnchangedError) return reply.code(409).send({ error: 'account_status_unchanged' });
  if (error instanceof SoleWorkspaceManagerError) {
    return reply.code(409).send({ error: 'sole_workspace_admin', workspaces: error.workspaces });
  }
  if (error instanceof NothingToRecoverError) return reply.code(409).send({ error: 'nothing_to_recover' });
  if (error instanceof NoPendingEnrollmentError) return reply.code(409).send({ error: 'no_pending_enrollment' });
  if (error instanceof WorkspaceNotFoundError) return reply.code(404).send({ error: 'workspace_not_found' });
  if (error instanceof MemberNotFoundError) return reply.code(404).send({ error: 'member_not_found' });
  if (error instanceof AlreadyMemberError) return reply.code(409).send({ error: 'already_member' });
  if (error instanceof ProcedureNotFoundError) return reply.code(404).send({ error: 'procedure_not_found' });
  if (error instanceof ProcedureConflictError) return reply.code(409).send({ error: 'procedure_conflict' });
  if (error instanceof InvalidProcedureReferenceError) return reply.code(400).send({ error: 'invalid_item_reference' });
  if (error instanceof RunNotFoundError) return reply.code(404).send({ error: 'run_not_found' });
  if (error instanceof RunStepNotFoundError) return reply.code(404).send({ error: 'step_not_found' });
  if (error instanceof RunIncompleteError) {
    return reply.code(409).send({ error: 'required_steps_open', openRequiredSteps: error.openRequiredSteps });
  }
  if (error instanceof RunNotActiveError) return reply.code(409).send({ error: 'run_not_active' });
  if (error instanceof StepStateConflictError) return reply.code(409).send({ error: 'step_conflict' });
  if (error instanceof OfflineAccountMismatchError) return reply.code(409).send({ error: 'offline_account_mismatch' });
  if (error instanceof ScheduleNotFoundError) return reply.code(404).send({ error: 'schedule_not_found' });
  if (error instanceof ScheduleConflictError) return reply.code(409).send({ error: 'schedule_conflict' });
  if (error instanceof ScheduleClosedError) return reply.code(409).send({ error: 'schedule_closed' });
  if (error instanceof ScheduleLimitReachedError) return reply.code(409).send({ error: 'schedule_limit_reached' });
  if (error instanceof ScheduledProcedureUnavailableError) return reply.code(409).send({ error: 'procedure_unavailable' });
  if (error instanceof ProcedureHasNoStepsError) return reply.code(409).send({ error: 'procedure_has_no_steps' });
  if (error instanceof RunLimitReachedError) return reply.code(409).send({ error: 'run_limit_reached' });
  if (error instanceof ProcedureLimitReachedError) return reply.code(409).send({ error: 'procedure_limit_reached' });
  if (error instanceof LastWorkspaceAdminError) return reply.code(409).send({ error: 'last_workspace_admin' });
  // Resolution failures of every kind share one answer (no hint about the target).
  if (error instanceof KnotNotFoundError) return reply.code(404).send({ error: 'knot_not_found' });
  if (error instanceof KnotRecordNotFoundError) return reply.code(404).send({ error: 'knot_not_found' });
  if (error instanceof KnotAlreadyRevokedError) return reply.code(409).send({ error: 'knot_already_revoked' });
  if (error instanceof KnotTargetNotFoundError) return reply.code(404).send({ error: 'knot_target_not_found' });
  if (error instanceof KnotLimitReachedError) return reply.code(409).send({ error: 'knot_limit_reached' });

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
