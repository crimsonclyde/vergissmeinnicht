import {
  AccountAlreadyExistsError,
  InvalidInvitationError,
  InvitationNotRevocableError,
  NotAuthorizedError,
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
