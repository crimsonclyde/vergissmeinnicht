import {
  AccountStatusUnchangedError,
  InvalidCursorError,
  SoleWorkspaceManagerError,
  KnotAlreadyRevokedError,
  KnotLimitReachedError,
  KnotNotFoundError,
  KnotRecordNotFoundError,
  KnotTargetNotFoundError,
  ImageNotFoundError,
  DocumentFileNotFoundError,
  DocumentConflictError,
  DocumentLimitReachedError,
  DocumentNotFoundError,
  DocumentTypeNotFoundError,
  FileInUseError,
  FolderMoveRefusedError,
  FolderNotFoundError,
  NameTakenError,
  ToolNotEnabledError,
  TextRetryNotPossibleError,
  InvalidSuggestionError,
  ToolSettingsConflictError,
  AlreadyLinkedError,
  DocumentFileRejectedError,
  LinkNotFoundError,
  LinkTargetNotFoundError,
  RunFinishedError,
  RunStillActiveError,
  ExportRunningError,
  ExportTooLargeError,
  StorageFullError,
  TooManyUploadsError,
  ListConflictError,
  ListItemLimitReachedError,
  ListItemNotFoundError,
  ListLimitReachedError,
  ListNotFoundError,
  ImageRejectedError,
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
  NotificationDeliveryError,
  NothingToConfirmError,
  TelegramUnavailableError,
  ScheduleClosedError,
  ScheduleConflictError,
  ScheduleLimitReachedError,
  ScheduleNotFoundError,
  ScheduledProcedureUnavailableError,
  InvalidAssigneeError,
  WrongScheduleKindError,
  NextOccurrenceInUseError,
  OccurrenceDateTakenError,
  RunNotEligibleError,
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
  ContactConflictError,
  ContactImportRefusedError,
  ContactLimitReachedError,
  ContactNotFoundError,
  EquipmentConflictError,
  EquipmentLimitReachedError,
  EquipmentRecordNotFoundError,
  MaintenanceConflictError,
  MaintenanceLimitReachedError,
  MaintenanceRecordNotFoundError,
  MaintenanceStatusUnchangedError,
  ReauthenticationFailedError,
  TotpAlreadyEnabledError,
  TotpLockedError,
  TotpNotEnabledError,
} from '@vergissmeinnicht/application';
import { DomainValidationError, MAX_EXPORT_BYTES, MAX_EXPORT_FILES } from '@vergissmeinnicht/domain';
import { ContactFileError, ProcedureImportError } from '@vergissmeinnicht/import-export';
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
  if (error instanceof InvalidAssigneeError) return reply.code(400).send({ error: 'invalid_assignee' });
  if (error instanceof WrongScheduleKindError) return reply.code(409).send({ error: 'wrong_schedule_kind' });
  if (error instanceof NextOccurrenceInUseError) return reply.code(409).send({ error: 'next_occurrence_in_use' });
  if (error instanceof OccurrenceDateTakenError) return reply.code(409).send({ error: 'occurrence_date_taken' });
  if (error instanceof RunNotEligibleError) return reply.code(409).send({ error: 'run_not_eligible' });
  if (error instanceof TelegramUnavailableError) return reply.code(409).send({ error: 'telegram_unavailable' });
  if (error instanceof NothingToConfirmError) return reply.code(409).send({ error: 'nothing_to_confirm' });
  // A provider check (e.g. a new bot token) failed: the stable reason code only, never the provider's answer.
  if (error instanceof NotificationDeliveryError) return reply.code(400).send({ error: 'provider_check_failed', reason: error.code });
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
  if (error instanceof ListNotFoundError) return reply.code(404).send({ error: 'list_not_found' });
  if (error instanceof ListItemNotFoundError) return reply.code(404).send({ error: 'list_item_not_found' });
  if (error instanceof ListConflictError) return reply.code(409).send({ error: 'list_conflict' });
  if (error instanceof ListLimitReachedError) return reply.code(409).send({ error: 'list_limit_reached' });
  if (error instanceof ListItemLimitReachedError) return reply.code(409).send({ error: 'list_item_limit_reached' });
  if (error instanceof ImageNotFoundError) return reply.code(404).send({ error: 'image_not_found' });
  // The stable reason only (e.g. heic_unsupported); never anything about the file's content.
  if (error instanceof ImageRejectedError) return reply.code(422).send({ error: 'image_rejected', reason: error.code });
  // A tool that is not switched on does not exist for this Workspace.
  if (error instanceof ToolNotEnabledError) return reply.code(404).send({ error: 'tool_not_enabled' });
  if (error instanceof ToolSettingsConflictError) return reply.code(409).send({ error: 'tool_settings_conflict' });
  if (error instanceof FolderNotFoundError) return reply.code(404).send({ error: 'folder_not_found' });
  if (error instanceof DocumentNotFoundError) return reply.code(404).send({ error: 'document_not_found' });
  if (error instanceof DocumentTypeNotFoundError) return reply.code(404).send({ error: 'document_type_not_found' });
  if (error instanceof DocumentConflictError) return reply.code(409).send({ error: 'document_conflict' });
  if (error instanceof NameTakenError) return reply.code(409).send({ error: 'name_taken' });
  if (error instanceof FolderMoveRefusedError) return reply.code(409).send({ error: error.code === 'cycle' ? 'folder_into_itself' : 'folder_too_deep' });
  if (error instanceof DocumentLimitReachedError) return reply.code(409).send({ error: 'document_limit_reached' });
  if (error instanceof FileInUseError) return reply.code(409).send({ error: 'file_in_use' });
  if (error instanceof DocumentFileNotFoundError) return reply.code(404).send({ error: 'file_not_found' });
  if (error instanceof TextRetryNotPossibleError) return reply.code(409).send({ error: 'text_retry_not_possible' });
  if (error instanceof InvalidSuggestionError) return reply.code(400).send({ error: 'invalid_suggestion' });
  // The stable reason only; `too_large` is the usual "payload too large".
  if (error instanceof DocumentFileRejectedError) return reply.code(error.code === 'too_large' ? 413 : 422).send({ error: 'file_rejected', reason: error.code });
  // One combined limit per Workspace (16.4): the same answer for a Document file and an instruction image.
  if (error instanceof StorageFullError) {
    return reply.code(409).send({ error: 'storage_full', usedBytes: error.usage.used, limitBytes: error.usage.limit });
  }
  if (error instanceof TooManyUploadsError) return reply.code(429).send({ error: 'too_many_uploads' });
  // An export beyond the bounds: how much it would be, and what one export may hold — so it can be split.
  if (error instanceof ExportTooLargeError) {
    return reply.code(413).send({ error: 'export_too_large', files: error.size.files, bytes: error.size.bytes, maxFiles: MAX_EXPORT_FILES, maxBytes: MAX_EXPORT_BYTES });
  }
  if (error instanceof ExportRunningError) return reply.code(429).send({ error: 'export_running' });
  // Links (16.5): a record of another Workspace, a deleted one and an unknown one all look the same.
  if (error instanceof LinkTargetNotFoundError) return reply.code(404).send({ error: 'link_target_not_found' });
  if (error instanceof LinkNotFoundError) return reply.code(404).send({ error: 'link_not_found' });
  if (error instanceof AlreadyLinkedError) return reply.code(409).send({ error: 'already_linked' });
  if (error instanceof RunFinishedError) return reply.code(409).send({ error: 'run_document_kept' });
  if (error instanceof RunStillActiveError) return reply.code(409).send({ error: 'run_still_active' });
  if (error instanceof EquipmentRecordNotFoundError) return reply.code(404).send({ error: 'equipment_not_found' });
  if (error instanceof EquipmentConflictError) return reply.code(409).send({ error: 'equipment_conflict' });
  if (error instanceof EquipmentLimitReachedError) return reply.code(409).send({ error: 'equipment_limit_reached' });
  // Contacts (16.6).
  if (error instanceof ContactNotFoundError) return reply.code(404).send({ error: 'contact_not_found' });
  if (error instanceof ContactConflictError) return reply.code(409).send({ error: 'contact_conflict' });
  if (error instanceof ContactLimitReachedError) return reply.code(409).send({ error: 'contact_limit_reached' });
  // Maintenance (16.7). A stale change answers with the code alone; the client then shows the current state.
  if (error instanceof MaintenanceRecordNotFoundError) return reply.code(404).send({ error: 'maintenance_not_found' });
  if (error instanceof MaintenanceConflictError) return reply.code(409).send({ error: 'maintenance_conflict' });
  if (error instanceof MaintenanceStatusUnchangedError) return reply.code(409).send({ error: 'maintenance_status_unchanged' });
  if (error instanceof MaintenanceLimitReachedError) return reply.code(409).send({ error: 'maintenance_limit_reached' });
  // A file that cannot be used as a whole: the stable reason and, where known, the line — never its content.
  if (error instanceof ContactImportRefusedError) return reply.code(422).send({ error: 'contact_import_refused', reason: error.code });
  if (error instanceof ContactFileError) return reply.code(error.code === 'contact_import_too_large' ? 413 : 422).send({ error: 'contact_import_refused', reason: error.code, line: error.line });

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
