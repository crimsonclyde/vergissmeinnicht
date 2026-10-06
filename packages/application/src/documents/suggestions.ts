import { parseDocumentId, parseSuggestionField, suggestFromText, suggestionKey, type DocumentSuggestion, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { DocumentRecord, DocumentRepository, WorkspaceToolRepository } from '../ports/document-repository.ts';
import type { DocumentTextRepository } from '../ports/document-texts.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { DocumentNotFoundError, InvalidSuggestionError } from './errors.ts';
import { authorizeTool } from './tools.ts';

export interface SuggestionDeps {
  readonly workspaces: WorkspaceRepository;
  readonly tools: WorkspaceToolRepository;
  readonly documents: DocumentRepository;
  readonly texts: DocumentTextRepository;
  readonly clock: Clock;
}

/** A suggestion as offered on a Document: where it comes from — the file and the page — and the line it was read from. */
export interface OfferedSuggestion extends DocumentSuggestion {
  /** 1-based position of the file in the Document. */
  readonly file: number;
}

/** Whether a suggestion would change nothing: the Document already says the same. */
function alreadySo(document: DocumentRecord, suggestion: DocumentSuggestion): boolean {
  switch (suggestion.field) {
    case 'title':
      return document.title.trim().toLowerCase() === suggestion.value.trim().toLowerCase();
    case 'type':
      return document.type?.kind === 'builtin' && document.type.key === suggestion.value;
    case 'documentDate':
      return document.documentDate === suggestion.value;
    case 'amount':
    case 'supplier':
      // Kept in the notes when accepted (a Document has no such fields): offered until they are there.
      return document.notes.toLowerCase().includes(suggestion.value.toLowerCase());
    case 'dueDate':
      return false;
  }
}

/**
 * Suggestions for a Document from its recognised text (16.9 task 5), for those who may change it
 * (`document.manage`) — guests change nothing, so they are offered nothing. Rules only, computed now
 * from the stored text: nothing is applied, stored or created here. Dismissed ones and those the
 * Document already says are left out.
 */
export async function documentSuggestions(deps: SuggestionDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly documentId: string }): Promise<OfferedSuggestion[]> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.manage');
  const documentId = parseDocumentId(input.documentId);
  const document = await deps.documents.findDocument(input.workspaceId, documentId);
  if (document === undefined) throw new DocumentNotFoundError();
  const source = await deps.texts.suggestionSource(input.workspaceId, documentId);
  if (source === undefined) return [];
  const dismissed = await deps.texts.dismissals(input.workspaceId, documentId);
  return suggestFromText(source.text)
    .filter((suggestion) => !dismissed.has(suggestionKey(suggestion.field, suggestion.value)) && !alreadySo(document, suggestion))
    .map((suggestion) => ({ ...suggestion, file: source.file }));
}

/** "Not this": the suggestion is not offered again on this Document, also after the text is read again. */
export async function dismissSuggestion(
  deps: SuggestionDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly documentId: string; readonly field: string; readonly value: string },
): Promise<void> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.manage');
  const documentId = parseDocumentId(input.documentId);
  const field = parseSuggestionField(input.field);
  if (field === undefined || input.value.trim() === '' || input.value.length > 300) throw new InvalidSuggestionError();
  const result = await deps.texts.dismiss({ workspaceId: input.workspaceId, documentId, key: suggestionKey(field, input.value), at: deps.clock.now() }, userActor(input.actor), {
    tool: 'DOCUMENTS',
    actorMay: (role) => roleHasCapability(role, 'document.manage'),
  });
  if (result === 'forbidden') throw new NotAuthorizedError();
  if (result === 'not_found') throw new DocumentNotFoundError();
}
