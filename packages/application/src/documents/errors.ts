import type { DocumentStorageUsage } from '../ports/document-files.ts';
import type { ExportSize } from '../ports/document-repository.ts';

/** Unknown file, one of another Workspace, a preview that does not exist, or bytes missing from the store: all look the same. */
export class DocumentFileNotFoundError extends Error {
  constructor() {
    super('File not found');
    this.name = 'DocumentFileNotFoundError';
  }
}

/** The Workspace's combined storage is full (H7) — for a Document file or an instruction image alike; everything already stored stays readable. */
export class StorageFullError extends Error {
  readonly usage: DocumentStorageUsage;

  constructor(usage: DocumentStorageUsage) {
    super('The Workspace storage is full');
    this.name = 'StorageFullError';
    this.usage = usage;
  }
}

/** This person already has as many uploads running as allowed at once. */
export class TooManyUploadsError extends Error {
  constructor() {
    super('Too many uploads at once');
    this.name = 'TooManyUploadsError';
  }
}

/** The Documents tool is not switched on in this Workspace: its routes answer like an unknown resource. */
export class ToolNotEnabledError extends Error {
  constructor() {
    super('Tool not enabled');
    this.name = 'ToolNotEnabledError';
  }
}

/** Unknown Folder, one of another Workspace, or one in Trash. */
export class FolderNotFoundError extends Error {
  constructor() {
    super('Folder not found');
    this.name = 'FolderNotFoundError';
  }
}

/** Unknown Document, one of another Workspace, or one in Trash. */
export class DocumentNotFoundError extends Error {
  constructor() {
    super('Document not found');
    this.name = 'DocumentNotFoundError';
  }
}

/** Unknown or retired document type, or one of another Workspace. */
export class DocumentTypeNotFoundError extends Error {
  constructor() {
    super('Document type not found');
    this.name = 'DocumentTypeNotFoundError';
  }
}

/** Someone else changed the Folder or Document in the meantime. */
export class DocumentConflictError extends Error {
  constructor() {
    super('Changed by someone else');
    this.name = 'DocumentConflictError';
  }
}

/** A sibling Folder (or another type) already has this name. */
export class NameTakenError extends Error {
  constructor() {
    super('The name is already in use');
    this.name = 'NameTakenError';
  }
}

/** A Folder cannot go there: into itself or one of its sub-folders (`cycle`), or deeper than ten levels (`too_deep`). */
export class FolderMoveRefusedError extends Error {
  readonly code: 'cycle' | 'too_deep';

  constructor(code: 'cycle' | 'too_deep') {
    super('The folder cannot be moved there');
    this.name = 'FolderMoveRefusedError';
    this.code = code;
  }
}

/** The Workspace has as many Folders, Documents or types as it may hold. */
export class DocumentLimitReachedError extends Error {
  constructor() {
    super('Limit reached');
    this.name = 'DocumentLimitReachedError';
  }
}

/** A file is already part of another Document. */
export class FileInUseError extends Error {
  constructor() {
    super('The file belongs to another document');
    this.name = 'FileInUseError';
  }
}

/** What was asked for is more than one export may hold (16.4): the answer names how much it would be. */
export class ExportTooLargeError extends Error {
  readonly size: ExportSize;

  constructor(size: ExportSize) {
    super('The export is too large');
    this.name = 'ExportTooLargeError';
    this.size = size;
  }
}

/** This person already has an export running. */
export class ExportRunningError extends Error {
  constructor() {
    super('An export is already running');
    this.name = 'ExportRunningError';
  }
}
