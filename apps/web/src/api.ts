/** Thin JSON client for the same-origin API. The browser adds the `Origin` header the server checks. */
import type { ProcedureIcon, ReasonPolicy, RunState, StepState, UserPreferences, WorkspaceRole } from '@vergissmeinnicht/domain';
import { hasMessage, t } from './i18n/index.ts';

// Shared vocabulary comes from the domain package (browser-safe, no server code). The server still
// validates everything; these lists only drive the UI.
export { PROCEDURE_ICONS, REASON_POLICIES, WORKSPACE_ROLES } from '@vergissmeinnicht/domain';
export type { ProcedureIcon, ReasonPolicy, RunState, StepState, WorkspaceRole } from '@vergissmeinnicht/domain';

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly serverAdmin: boolean;
}


export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly role: WorkspaceRole;
  /** Optional tools switched on in the Workspace (16.2); absent in copies saved for offline use. */
  readonly tools?: readonly string[];
}

export interface WorkspaceMember {
  readonly userId: string;
  readonly displayName: string;
  readonly role: WorkspaceRole;
  readonly memberSince: string;
  /** Only returned to members who manage the Workspace. */
  readonly email?: string;
  readonly status?: string;
}



/** One optional instruction photo per Step, with its required caption (14.3). */
export interface StepImageRef {
  readonly id: string;
  readonly caption: string;
}

/** The Workspace's combined storage (16.4), as every author sees it: used and limit, in bytes. */
export interface ImageUsage {
  readonly usedBytes: number;
  readonly limitBytes: number;
}

/** The combined storage of a Workspace by tool, for its admins and the server admin (16.4). */
export interface StorageInfo extends ImageUsage {
  /** Document versions kept for executions whose document no longer holds these files. */
  readonly retainedBytes: number;
  /** Instruction photos of Procedures. */
  readonly imageBytes: number;
  /** Original files of Documents that are not in Trash. */
  readonly documentBytes: number;
  readonly previewBytes: number;
  readonly trashBytes: number;
  /** What the server admin allows this Workspace. */
  readonly ceilingBytes: number;
  /** The Workspace's own lower limit, if it has one. */
  readonly ownLimitBytes: number | null;
}

export interface WorkspaceStorage extends StorageInfo {
  readonly id: string;
  readonly name: string;
}

export interface StepInput {
  /** Existing Step id; omitted for new Steps (the server assigns ids). */
  readonly id?: string;
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon | null;
  readonly required: boolean;
  readonly critical: boolean;
  readonly skipReasonPolicy: ReasonPolicy;
  readonly notApplicableReasonPolicy: ReasonPolicy;
  readonly image?: StepImageRef | null;
}

export interface SectionInput {
  readonly id?: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly StepInput[];
}

export interface ProcedureContent {
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon;
  readonly tags: readonly string[];
  readonly sections: readonly SectionInput[];
}

/** List entry (no structure). */
export interface Procedure {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon;
  readonly tags: readonly string[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A Procedure in the list (13.10): the person's pin, last completion, active executions, next open Occurrence. */
export interface ProcedureCard extends Procedure {
  readonly pinned: boolean;
  readonly lastCompletedAt: string | null;
  readonly active: readonly ActiveExecution[];
  readonly nextOccurrence: { readonly id: string; readonly scheduleId: string; readonly date: string; readonly time: string | null; readonly timeZone: string } | null;
}

export interface ActiveExecution {
  readonly runId: string;
  readonly startedBy: string;
  readonly startedAt: string;
}

export type ReminderUnit = 'DAYS' | 'WEEKS' | 'MONTHS' | 'HOURS';
export interface ReminderOffset {
  readonly unit: ReminderUnit;
  readonly amount: number;
}

export type RecurrenceUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
/** One-time, fixed calendar, or counted from the last completion (14.1). */
export type Recurrence =
  | { readonly kind: 'ONCE' }
  | { readonly kind: 'FIXED'; readonly unit: RecurrenceUnit; readonly interval: number; readonly weekdays: readonly number[] | null; readonly lastDayOfMonth: boolean }
  | { readonly kind: 'AFTER_COMPLETION'; readonly unit: RecurrenceUnit; readonly interval: number };

export interface PersonRef {
  readonly id: string;
  readonly name: string;
}

/** A series of a standalone Reminder or of a Procedure (14.1). */
export interface Schedule {
  readonly id: string;
  readonly kind: 'REMINDER' | 'PROCEDURE';
  readonly procedureId: string | null;
  /** The Procedure as it is now; `deleted` = its Occurrences can no longer be started. */
  readonly procedure: { readonly title: string; readonly icon: ProcedureIcon; readonly deleted: boolean } | null;
  readonly title: string;
  readonly description: string;
  readonly recurrence: Recurrence;
  /** First due date (`YYYY-MM-DD`) and optional `HH:MM` in `timeZone`. */
  readonly date: string;
  readonly time: string | null;
  readonly timeZone: string;
  readonly reminders: readonly ReminderOffset[];
  readonly assignee: PersonRef | null;
  readonly state: 'ACTIVE' | 'PAUSED' | 'ENDED';
  readonly pausedAt: string | null;
  readonly ended: { readonly at: string; readonly by: string } | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly createdBy: string;
}

export type OccurrenceState = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';

/** One dated instance of a Schedule with its own state and history. */
export interface Occurrence {
  readonly id: string;
  readonly schedule: Schedule;
  readonly dueDate: string;
  readonly time: string | null;
  readonly state: OccurrenceState;
  /** This Occurrence's own Assignee (override). */
  readonly assignee: PersonRef | null;
  /** Who is responsible: the override, else the Schedule's Assignee; null = shared. */
  readonly responsible: PersonRef | null;
  readonly closed: { readonly at: string; readonly by: string } | null;
  readonly skipReason: string | null;
  readonly run: { readonly id: string; readonly state: RunState; readonly startedAt: string; readonly startedBy: string } | null;
  readonly revision: number;
}

/** A future date of a repeating Schedule that has no Occurrence yet (calendar, 14.4): shown, not actionable. */
export interface ProjectedOccurrence {
  readonly schedule: Schedule;
  readonly dueDate: string;
  readonly time: string | null;
  readonly responsible: PersonRef | null;
}

export interface CalendarRange {
  readonly from: string;
  readonly to: string;
  readonly occurrences: readonly Occurrence[];
  readonly projected: readonly ProjectedOccurrence[];
  /** More entries exist in the range than were sent. */
  readonly truncated: boolean;
}

export interface OccurrenceHistoryEntry extends Occurrence {
  readonly runs: readonly { readonly runId: string; readonly how: 'STARTED' | 'LINKED'; readonly linkedAt: string; readonly linkedBy: string; readonly ended: 'ABORTED' | 'UNLINKED' | null }[];
}

/** What the Schedule dialog sends; the server validates everything again. */
export interface ScheduleInput {
  readonly title?: string;
  readonly description?: string;
  readonly recurrence: Recurrence;
  readonly date: string;
  readonly time: string | null;
  readonly timeZone: string;
  readonly reminders: readonly ReminderOffset[];
  readonly assigneeUserId: string | null;
}

export interface TodayProgress {
  readonly filter: 'ALL' | 'MINE' | 'SHARED';
  readonly weekFrom: string;
  readonly weekTo: string;
  readonly completedOccurrencesToday: number | null;
  readonly completedRunsThisWeek: number | null;
  readonly activeRuns: number | null;
  readonly dueToday: number | null;
  readonly recentlyCompleted: readonly { readonly type: 'run' | 'occurrence'; readonly id: string; readonly scheduleId: string | null; readonly title: string; readonly completedAt: string }[];
}

export interface HomeOverview {
  readonly progress?: TodayProgress;
  readonly overdue: readonly Occurrence[];
  readonly today: readonly Occurrence[];
  /** The next 90 days. */
  readonly upcoming: readonly Occurrence[];
  /** Open Occurrences further ahead. */
  readonly later: number;
  readonly recentlyDone: readonly Occurrence[];
  readonly active: readonly RunSummary[];
  readonly pinned: readonly ProcedureCard[];
  readonly recent: readonly ProcedureCard[];
  readonly recentLimit: number;
}

/** A List (grocery list) in the overview (15.3). */
export interface ListSummary {
  readonly id: string;
  readonly kind: 'GROCERY';
  readonly title: string;
  /** Increases with every change to the List or its items. */
  readonly revision: number;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly deleted: boolean;
  /** Items still to buy / already purchased. */
  readonly open: number;
  readonly checked: number;
}

export interface ListItem {
  readonly id: string;
  readonly title: string;
  /** A positive decimal as text (`"1.5"`), or null. */
  readonly quantity: string | null;
  readonly unit: string | null;
  readonly revision: number;
  readonly addedBy: string;
  /** Purchased: who checked it and when. */
  readonly checked: { readonly at: string; readonly by: string } | null;
}

export interface ListDetail extends Omit<ListSummary, 'open' | 'checked'> {
  readonly items: readonly ListItem[];
}

export interface ListItemInput {
  readonly title: string;
  readonly quantity: string | null;
  readonly unit: string | null;
}

export interface NotificationSettings {
  readonly reminderTime: string;
  readonly email: { readonly available: boolean; readonly enabled: boolean };
  readonly telegram: {
    readonly available: boolean;
    readonly enabled: boolean;
    readonly connected: { readonly label: string; readonly connectedAt: string } | null;
    readonly pairing: { readonly expiresAt: string; readonly claimedBy: string | null } | null;
  };
}

/** Server-wide providers; never contains a provider credential. */
export interface NotificationProviders {
  readonly email: { readonly configured: boolean; readonly enabled: boolean };
  readonly telegram: { readonly enabled: boolean; readonly configured: boolean; readonly botName: string | null };
}

export interface InstanceSettings {
  readonly footerHidden: boolean;
  readonly recentProceduresLimit: number;
  /** Largest accepted document file, in bytes (1 MB to 100 MB). */
  readonly documentMaxFileBytes: number;
  readonly documentFormats: readonly DocumentFileFormat[];
}

export interface DeletedProcedure extends Procedure {
  readonly deletedAt: string;
  /** Display name of the person who deleted it. */
  readonly deletedBy: string;
}

export interface ProcedureStep extends StepInput {
  readonly id: string;
  readonly kind: 'CHECK';
}

export interface ProcedureSection {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly ProcedureStep[];
}

export interface ProcedureDetail extends Procedure {
  readonly sections: readonly ProcedureSection[];
}


export interface RunInfo {
  readonly id: string;
  readonly procedureId: string;
  readonly procedureRevision: number;
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon;
  readonly tags: readonly string[];
  readonly state: RunState;
  /** Increases with every change; used to notice missed live updates. */
  readonly revision: number;
  readonly startedAt: string;
  /** Display name at the time the Run was started. */
  readonly startedBy: string;
  /** Set once the Run is COMPLETED or ABORTED. */
  readonly ended: { readonly at: string; readonly by: string; readonly reason: string | null } | null;
}

export interface RunSummary extends RunInfo {
  readonly stepCounts: Readonly<Record<StepState, number>>;
}

export interface RunStep {
  readonly id: string;
  readonly kind: 'CHECK';
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon | null;
  readonly required: boolean;
  readonly critical: boolean;
  readonly skipReasonPolicy: ReasonPolicy;
  readonly notApplicableReasonPolicy: ReasonPolicy;
  /** The photo as it was when the Run started. */
  readonly image: StepImageRef | null;
  readonly state: StepState;
  /**
   * Who set the current state (display-name snapshot), when (server time), and why. `deviceAt`: the
   * device clock of a change made offline and sent later — informational only (8.5).
   */
  readonly stateChange: { readonly by: string; readonly at: string; readonly reason: string | null; readonly deviceAt?: string | null } | null;
}

export interface RunDetail extends RunInfo {
  readonly sections: readonly { readonly id: string; readonly title: string; readonly description: string; readonly steps: readonly RunStep[] }[];
}

export interface HistoryEvent {
  readonly id: string;
  readonly type: string;
  readonly at: string;
  /** Display name at the time of the event. */
  readonly actor: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

/** One page of a list; pass `nextCursor` back to load the following page (null = last page). */
export interface HistoryPage {
  readonly events: HistoryEvent[];
  readonly nextCursor: string | null;
}

export interface SecurityLogEntry {
  readonly id: string;
  readonly type: string;
  readonly at: string;
  /** Display-name snapshot or system channel (e.g. `anonymous`, `cli:admin-recover`). */
  readonly actor: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly subjectEmail: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export type KnotTargetType = 'PROCEDURE' | 'RUN';

export interface KnotInfo {
  readonly id: string;
  readonly label: string;
  /** `title` is null right after creation; `available` is false for a deleted Procedure. */
  readonly target: { readonly type: KnotTargetType; readonly id: string; readonly title: string | null; readonly available: boolean };
  readonly status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  readonly createdAt: string;
  /** Display name of the creator. */
  readonly createdBy: string;
  readonly expiresAt: string | null;
  readonly revoked: { readonly at: string; readonly by: string } | null;
}

export interface PendingInvitation {
  readonly id: string;
  readonly email: string;
  readonly grantsServerAdmin: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface AccountInfo {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: 'ACTIVE' | 'DISABLED';
  readonly serverAdmin: boolean;
  readonly totpEnabled: boolean;
  readonly createdAt: string;
}

export type SecondFactor = { readonly code: string } | { readonly recoveryCode: string };

export interface MfaStatus {
  readonly totpEnabled: boolean;
  readonly recoveryCodesRemaining: number;
}

/** User-facing text for an API error: the catalog's `error.<code>` message, else the fallback. */
export function messageFor(error: unknown, fallback: string = t('error.generic')): string {
  const key = error instanceof ApiError ? `error.${error.code}` : '';
  return hasMessage(key) ? t(key) : fallback;
}

/** The request never got an answer (offline, server unreachable) — as opposed to an error answer. */
export const isNetworkError = (error: unknown): boolean => !(error instanceof ApiError) && error instanceof TypeError;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The rest of the error body (e.g. the Workspaces of `sole_workspace_admin`). */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(status: number, code: string, details: Readonly<Record<string, unknown>> = {}) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const afterQuery = (after: string | undefined) => (after === undefined ? '' : `?after=${encodeURIComponent(after)}`);

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const { error, ...details } = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(response.status, error ?? 'request_failed', details);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** The image as served to members of the Workspace (same-origin, session cookie). */
export const imageUrl = (workspaceId: string, imageId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/images/${encodeURIComponent(imageId)}`;

/** Sends raw bytes (image or archive) and maps error answers like `request`. */
async function sendBytes<T>(path: string, body: Blob): Promise<T> {
  const response = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body });
  if (!response.ok) {
    const { error, ...details } = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(response.status, error ?? 'request_failed', details);
  }
  return (await response.json()) as T;
}

/** A Procedure archive (JSON document + images) as a file to save. */
async function exportProcedureArchive(workspaceId: string, id: string): Promise<Blob> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/archive`, { credentials: 'same-origin' });
  if (!response.ok) {
    const { error, ...details } = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(response.status, error ?? 'request_failed', details);
  }
  return response.blob();
}

/** Raw bytes (not JSON): the server identifies, checks and re-encodes the image. */
async function uploadImage(workspaceId: string, image: Blob, replacing?: string): Promise<{ image: { id: string; width: number; height: number }; usage: ImageUsage }> {
  const query = replacing === undefined ? '' : `?replacing=${encodeURIComponent(replacing)}`;
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/images${query}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/octet-stream' },
    body: image,
  });
  if (!response.ok) {
    const { error, ...details } = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    // 413 comes from the body limit, before any route code.
    throw new ApiError(response.status, response.status === 413 ? 'image_too_large' : (error ?? 'request_failed'), details);
  }
  return (await response.json()) as { image: { id: string; width: number; height: number }; usage: ImageUsage };
}

// ---- Documents (16.1, 16.2)

export type DocumentFileFormat = 'PDF' | 'JPEG' | 'PNG' | 'HEIC';

/** One file of a Document: an original with what the server found out about it. Never a storage name. */
export interface DocumentFile {
  readonly id: string;
  readonly name: string;
  readonly format: DocumentFileFormat;
  readonly bytes: number;
  /** Pages of a PDF (null when password-protected); 1 for an image. */
  readonly pageCount: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly passwordProtected: boolean;
  readonly activeContent: boolean;
  readonly preview: {
    readonly state: 'PENDING' | 'READY' | 'PARTIAL' | 'FAILED' | 'NONE';
    /** Preview pages that exist. */
    readonly pages: number;
    /** Why there is no preview at all: the format has none, or the PDF needs a password. */
    readonly unavailable: 'format' | 'password_protected' | null;
  };
  readonly uploadedBy: string;
  readonly uploadedAt: string;
}

export interface DocumentFolder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly revision: number;
  /** Documents directly in this Folder. */
  readonly documents: number;
}

export type DocumentTypeView = { readonly kind: 'builtin'; readonly key: string } | { readonly kind: 'custom'; readonly id: string; readonly name: string; readonly retired: boolean };

export interface DocumentSummary {
  readonly id: string;
  readonly folderId: string | null;
  readonly title: string;
  readonly type: DocumentTypeView | null;
  readonly documentDate: string | null;
  readonly year: number | null;
  readonly tags: readonly string[];
  readonly revision: number;
  readonly files: number;
  readonly cover: { readonly fileId: string; readonly hasThumbnail: boolean } | null;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
  readonly modifiedAt: string;
  readonly modifiedBy: string;
}

/** One page of a listing (16.3): fifty at most; `total` only comes with the first page. */
export interface DocumentListing {
  readonly documents: DocumentSummary[];
  readonly nextCursor: string | null;
  readonly total: number | null;
}

/** What the filters can be set to: values that Documents of the Workspace actually have. */
export interface DocumentFilterValues {
  readonly years: number[];
  readonly tags: string[];
  readonly uploaders: string[];
}

export interface DocumentDetail extends DocumentSummary {
  readonly notes: string;
  readonly pages: readonly DocumentFile[];
}

/** The fields a person fills in; only the title is required. */
export interface DocumentFields {
  readonly title: string;
  readonly type: { readonly builtIn: string } | { readonly customId: string } | null;
  readonly documentDate: string | null;
  readonly year: number | null;
  readonly notes: string;
  readonly tags: readonly string[];
}

export interface DocumentTypes {
  readonly builtIn: readonly string[];
  readonly custom: readonly { readonly id: string; readonly name: string; readonly retired: boolean }[];
}

export interface TrashEntry {
  readonly kind: 'folder' | 'document';
  readonly id: string;
  readonly name: string;
  readonly location: readonly string[];
  readonly deletedAt: string;
  readonly deletedBy: string;
  readonly folders: number;
  readonly documents: number;
  /** Files it holds (for a Folder: of everything that went to Trash with it). */
  readonly files: number;
}

/** What a restore did when the item could not simply return to its place. */
export interface RestoreOutcome {
  readonly folders: number;
  readonly documents: number;
  readonly renamedTo: string | null;
  readonly movedTo: { readonly id: string | null; readonly name: string | null; readonly because: string } | null;
}

const documentsPath = (workspaceId: string, rest = '') => `/workspaces/${encodeURIComponent(workspaceId)}/documents${rest}`;
const foldersPath = (workspaceId: string, rest = '') => `/workspaces/${encodeURIComponent(workspaceId)}/document-folders${rest}`;
const documentTypesPath = (workspaceId: string, rest = '') => `/workspaces/${encodeURIComponent(workspaceId)}/document-types${rest}`;
const documentFilePath = (workspaceId: string, fileId: string, rest = '') => `/api/workspaces/${encodeURIComponent(workspaceId)}/document-files/${encodeURIComponent(fileId)}${rest}`;

/** Addresses of a file's derived images and of its original (same-origin, session cookie; the server authorizes each request). */
// ---- Links (16.5)

/** The other end of a Link as it may be shown: kind, title and where it stands today — never content. */
export interface LinkedRecord {
  readonly type: 'document' | 'procedure' | 'schedule' | 'contact' | 'run' | 'maintenance' | 'equipment';
  readonly id: string;
  /** `null`: gone for good, or in Trash and not for this viewer to see (a Contact in Trash is never named). */
  readonly title: string | null;
  readonly state: 'ok' | 'deleted' | 'trash' | 'paused' | 'ended' | 'gone';
  readonly scheduleKind: 'REMINDER' | 'PROCEDURE' | null;
  /** An execution as the other end of a Link: whether it is still going. */
  readonly maintenanceDate?:string;
  readonly maintenanceStatus?:MaintenanceStatus;
  readonly runState?: RunState | null;
  readonly nextDue: string | null;
  readonly goneAt: string | null;
  readonly goneBy: string | null;
}

export interface DocumentLink {
  readonly sourceType?:string;
  readonly id: string;
  readonly record: LinkedRecord;
  readonly createdAt: string;
  readonly createdBy: string;
}

/** A Run that keeps a version of the Document. */
export interface RunLink {
  readonly id: string;
  readonly runId: string;
  readonly title: string;
  readonly state: RunState;
  readonly linkedAt: string;
  readonly linkedBy: string;
  readonly changedSince: boolean;
}

/** A Document version a Run keeps: what the Document was when it was linked, with its files of then. */
export interface RunDocument {
  readonly id: string;
  readonly sourceDocumentId: string;
  /** How the Document it came from stands today. */
  readonly source: 'same' | 'changed' | 'trash' | 'gone';
  readonly title: string;
  readonly type: { readonly kind: 'builtin'; readonly key: string } | { readonly kind: 'custom'; readonly name: string } | null;
  readonly documentDate: string | null;
  readonly year: number | null;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly files: readonly DocumentFile[];
  readonly linkedAt: string;
  readonly linkedBy: string;
}

/** The permanent note of a document removed from a finished execution: who, when, why — nothing of the document. */
export interface RunDocumentRemoval {
  readonly id: string;
  readonly reason: string;
  readonly files: number;
  readonly linkedAt: string;
  readonly linkedBy: string;
  readonly removedAt: string;
  readonly removedBy: string;
}

/** How much an export would hold, and what one export may hold at most. */
export interface ExportSize {
  readonly documents: number;
  readonly files: number;
  readonly bytes: number;
  readonly maxFiles: number;
  readonly maxBytes: number;
}

/** The address of an export (a ZIP download): everything, one Folder with its sub-folders, or chosen Documents. */
/** An email address or phone number of a Contact; `href` is the `mailto:` / `tel:` link the server built from the checked value. */
export interface ContactPointView {
  readonly value: string;
  readonly label: string;
  readonly href: string;
}

export interface ContactSummary {
  readonly id: string;
  readonly name: string;
  readonly organisation: string;
  readonly category: string;
  readonly emails: readonly ContactPointView[];
  readonly phones: readonly ContactPointView[];
  readonly revision: number;
}

export interface Contact extends ContactSummary {
  readonly address: string;
  /** An `http(s)` address, or empty. */
  readonly website: string;
  readonly notes: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly modifiedAt: string;
  readonly modifiedBy: string;
}

/** What a Contact is made of, as it is sent. Only the name is required. */
export interface ContactInput {
  readonly name: string;
  readonly organisation?: string;
  readonly category?: string;
  readonly emails?: readonly { readonly value: string; readonly label?: string }[];
  readonly phones?: readonly { readonly value: string; readonly label?: string }[];
  readonly address?: string;
  readonly website?: string;
  readonly notes?: string;
}

/** Another Contact that may be the same person or organisation, and what the two share. */
export interface ContactDuplicate {
  readonly id: string;
  readonly name: string;
  readonly organisation: string;
  readonly reasons: readonly ('email' | 'phone' | 'name')[];
}

export interface TrashedContact {
  readonly id: string;
  readonly name: string;
  readonly organisation: string;
  readonly deletedAt: string;
  readonly deletedBy: string;
}

export interface ContactProcedureLink {
  readonly id: string;
  readonly procedureId: string;
  readonly title: string | null;
  readonly state: 'ok' | 'deleted' | 'gone';
}

/** A Contact linked to a Procedure; `contact` is `null` for a deleted contact. */
export interface ProcedureContactLink {
  readonly id: string;
  readonly contact: ContactSummary | null;
}

export type ContactFileFormat = 'csv' | 'vcard';

/** One entry of an import file, as the server would save it — or why it cannot be imported. */
export interface ContactImportEntry {
  readonly line: number;
  readonly name: string;
  readonly contact: ContactInput | null;
  readonly problem: { readonly code: string; readonly field: string } | null;
  readonly duplicates: readonly ContactDuplicate[];
  readonly sameAs: readonly { readonly entry: number; readonly reasons: readonly ('email' | 'phone' | 'name')[] }[];
}

export interface EquipmentInput { readonly name:string; readonly category?:string; readonly location?:string; readonly manufacturer?:string; readonly model?:string; readonly serialNumber?:string; readonly purchaseDate?:string|null; readonly warrantyExpiry?:string|null; readonly notes?:string }
export interface EquipmentRecord {readonly id:string;readonly name:string;readonly category:string;readonly location:string;readonly manufacturer:string;readonly model:string;readonly serialNumber:string;readonly purchaseDate:string|null;readonly warrantyExpiry:string|null;readonly notes:string;readonly revision:number;readonly createdAt:string;readonly createdBy:string;readonly modifiedAt:string;readonly modifiedBy:string}
export interface EquipmentFilters {readonly categories:string[];readonly locations:string[];readonly manufacturers:string[]}
export interface TrashedEquipment {readonly id:string;readonly name:string;readonly deletedAt:string;readonly deletedBy:string}
const equipmentPath=(workspaceId:string,rest='')=>`/workspaces/${encodeURIComponent(workspaceId)}/equipment${rest}`;

export type MaintenanceStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

/** A MaintenanceRecord as a card or a row shows it. */
export interface MaintenanceSummary {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  /** When the work is planned for, `YYYY-MM-DD`. */
  readonly date: string | null;
  readonly status: MaintenanceStatus;
  /** Set exactly while the status is COMPLETED. */
  readonly completedOn: string | null;
  /** The responsible Contact; `name` is `null` for a deleted contact. */
  readonly contact: { readonly id: string; readonly name: string | null } | null;
  /** As recorded: decimal text and a currency code. */
  readonly cost: { readonly amount: string; readonly currency: string } | null;
  readonly revision: number;
}

export interface MaintenanceRecord extends MaintenanceSummary {
  readonly description: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly modifiedAt: string;
  readonly modifiedBy: string;
}

export interface MaintenanceColumn {
  readonly status: MaintenanceStatus;
  readonly total: number;
  readonly records: readonly MaintenanceSummary[];
}

export interface MaintenanceFilterValues {
  readonly categories: readonly string[];
  readonly years: readonly number[];
  readonly contacts: readonly { readonly id: string; readonly name: string }[];
}

export interface MaintenanceInput {
  readonly title: string;
  readonly category?: string;
  readonly date?: string | null;
  readonly description?: string;
  readonly contactId?: string | null;
  readonly cost?: { readonly amount: string; readonly currency: string } | null;
}

export interface TrashedMaintenanceRecord {
  readonly id: string;
  readonly title: string;
  readonly status: MaintenanceStatus;
  readonly deletedAt: string;
  readonly deletedBy: string;
}

const maintenancePath = (workspaceId: string, rest = '') => `/workspaces/${encodeURIComponent(workspaceId)}/maintenance${rest}`;

const contactsPath = (workspaceId: string, rest = '') => `/workspaces/${encodeURIComponent(workspaceId)}/contacts${rest}`;
/** Every Contact as one file to save (USER and above). */
export const contactExportUrl = (workspaceId: string, format: ContactFileFormat) => `/api${contactsPath(workspaceId, `/export?format=${format}`)}`;

export const documentExportUrl = (workspaceId: string, scope: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/documents/export${scope === '' ? '' : `?${scope}`}`;

export const documentFileUrls = {
  thumbnail: (workspaceId: string, fileId: string) => documentFilePath(workspaceId, fileId, '/thumbnail'),
  /** Preview page `page`, counted from 1. */
  page: (workspaceId: string, fileId: string, page: number) => documentFilePath(workspaceId, fileId, `/pages/${page}`),
  /** The unchanged original, always answered as a download. */
  original: (workspaceId: string, fileId: string) => documentFilePath(workspaceId, fileId, '/original'),
};

/**
 * Uploads one file as it is — nothing is converted or resized in the browser: the original is what is
 * kept. Reports progress (0–1) and can be cancelled. XMLHttpRequest, because `fetch` cannot report
 * upload progress.
 */
function uploadDocumentFile(workspaceId: string, file: Blob, name: string, options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<DocumentFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/document-files`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    // The name is data for the server to check; percent-encoded, as a header value must be ASCII.
    xhr.setRequestHeader('x-file-name', encodeURIComponent(name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as { file?: DocumentFile; error?: string } & Record<string, unknown>;
      if (xhr.status === 201 && body.file !== undefined) return resolve(body.file);
      const { error, ...details } = body;
      reject(new ApiError(xhr.status, error ?? 'request_failed', details));
    };
    // No answer at all (offline, connection closed): the same kind of failure `fetch` reports.
    xhr.onerror = () => reject(new TypeError('upload failed'));
    xhr.onabort = () => reject(new DOMException('cancelled', 'AbortError'));
    options.signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

const listPath = (workspaceId: string, listId?: string) => `/workspaces/${encodeURIComponent(workspaceId)}/lists${listId === undefined ? '' : `/${encodeURIComponent(listId)}`}`;
const listItemPath = (workspaceId: string, listId: string, itemId: string) => `${listPath(workspaceId, listId)}/items/${encodeURIComponent(itemId)}`;
const listOf = async (response: Promise<{ list: ListDetail }>) => (await response).list;
const schedulePath = (workspaceId: string, scheduleId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}`;
const occurrencePath = (workspaceId: string, id: string) => `/workspaces/${encodeURIComponent(workspaceId)}/occurrences/${encodeURIComponent(id)}`;

export const api = {
  uploadImage,
  imageUsage: async (workspaceId: string) => (await request<{ usage: ImageUsage }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/images/usage`)).usage,
  // Storage (16.4): the Workspace's own view and limit; every Workspace and its ceiling for the server admin.
  workspaceStorage: async (workspaceId: string) => (await request<{ storage: StorageInfo }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/storage`)).storage,
  setWorkspaceStorageLimit: async (workspaceId: string, bytes: number | null) =>
    (await request<{ storage: StorageInfo }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/storage/limit`, { bytes })).storage,
  adminStorage: async () => (await request<{ workspaces: WorkspaceStorage[] }>('GET', '/admin/storage')).workspaces,
  setStorageCeiling: (workspaceId: string, bytes: number) => request<undefined>('POST', `/admin/storage/${encodeURIComponent(workspaceId)}/ceiling`, { bytes }),
  about: () => request<{ license: string; sourceCodeUrl: string; footerHidden: boolean }>('GET', '/about'),
  instanceSettings: async () => (await request<{ settings: InstanceSettings }>('GET', '/admin/settings')).settings,
  updateInstanceSettings: async (settings: Partial<InstanceSettings>) =>
    (await request<{ settings: InstanceSettings }>('POST', '/admin/settings', settings)).settings,
  notificationProviders: async () => (await request<{ providers: NotificationProviders }>('GET', '/admin/notifications')).providers,
  setEmailReminders: async (enabled: boolean) =>
    (await request<{ providers: NotificationProviders }>('POST', '/admin/notifications/email', { enabled })).providers,
  /** `botToken`: a new token (checked by the server with Telegram), `null` removes it, omitted keeps it. It is never sent back. */
  configureTelegram: async (input: { enabled: boolean; botToken?: string | null }) =>
    (await request<{ providers: NotificationProviders }>('POST', '/admin/notifications/telegram', input)).providers,
  testNotificationProvider: async (provider: 'EMAIL' | 'TELEGRAM') =>
    (await request<{ result: { delivered: boolean; botName?: string; reason?: string } }>('POST', '/admin/notifications/test', { provider })).result,
  notificationSettings: async () => (await request<{ settings: NotificationSettings }>('GET', '/account/notifications')).settings,
  updateNotificationSettings: async (changes: { reminderTime?: string; emailReminders?: boolean; telegramReminders?: boolean }) =>
    (await request<{ settings: NotificationSettings }>('POST', '/account/notifications', changes)).settings,
  /** The link carries a one-time token; it is shown once. */
  startTelegramPairing: () => request<{ url: string; expiresAt: string }>('POST', '/account/notifications/telegram/pair'),
  confirmTelegramPairing: async () => (await request<{ settings: NotificationSettings }>('POST', '/account/notifications/telegram/confirm')).settings,
  cancelTelegramPairing: async () => (await request<{ settings: NotificationSettings }>('POST', '/account/notifications/telegram/cancel')).settings,
  disconnectTelegram: async () => (await request<{ settings: NotificationSettings }>('POST', '/account/notifications/telegram/disconnect')).settings,
  currentUser: async (): Promise<CurrentUser | null> => {
    try {
      return (await request<{ user: CurrentUser }>('GET', '/auth/session')).user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  /** Either a full sign-in or the request for the second factor (no session exists yet). */
  signIn: (email: string, password: string) =>
    request<{ user: CurrentUser } | { mfaRequired: true }>('POST', '/auth/sign-in', { email, password }),
  completeMfa: async (factor: SecondFactor) => (await request<{ user: CurrentUser }>('POST', '/auth/mfa', factor)).user,
  mfaStatus: () => request<MfaStatus>('GET', '/account/mfa'),
  preferences: async () => (await request<{ preferences: UserPreferences }>('GET', '/account/preferences')).preferences,
  updatePreferences: async (changes: Partial<UserPreferences>) =>
    (await request<{ preferences: UserPreferences }>('POST', '/account/preferences', changes)).preferences,
  startTotp: (password: string) => request<{ secret: string; uri: string }>('POST', '/account/mfa/totp/setup', { password }),
  confirmTotp: (code: string) => request<{ recoveryCodes: string[] }>('POST', '/account/mfa/totp/confirm', { code }),
  disableTotp: (password: string, factor: SecondFactor) =>
    request<undefined>('POST', '/account/mfa/totp/disable', { password, ...factor }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<undefined>('POST', '/account/password', { currentPassword, newPassword }),
  resolveRecovery: (token: string) =>
    request<{ email: string; resetPassword: boolean; resetTotp: boolean; requiresCurrentPassword: boolean; expiresAt: string }>(
      'POST',
      '/recoveries/resolve',
      { token },
    ),
  completeRecovery: (token: string, passwords: { newPassword?: string; currentPassword?: string }) =>
    request<undefined>('POST', '/recoveries/complete', { token, ...passwords }),
  regenerateRecoveryCodes: (password: string) =>
    request<{ recoveryCodes: string[] }>('POST', '/account/mfa/recovery-codes', { password }),
  signOut: () => request<undefined>('POST', '/auth/sign-out'),
  invitations: async () => (await request<{ invitations: PendingInvitation[] }>('GET', '/admin/invitations')).invitations,
  invite: (email: string, grantsServerAdmin: boolean) =>
    request<{ invitation: PendingInvitation; delivery: 'sent' | 'failed' }>('POST', '/admin/invitations', { email, grantsServerAdmin }),
  revokeInvitation: (id: string) => request<undefined>('POST', `/admin/invitations/${encodeURIComponent(id)}/revoke`),
  startRecovery: (input: {
    email: string;
    resetPassword: boolean;
    resetTotp: boolean;
    password: string;
    code?: string;
  }) => request<{ recovery: { expiresAt: string }; delivery: 'sent' | 'failed' }>('POST', '/admin/recoveries', input),
  securityLog: (page: { before?: string; userId?: string } = {}) => {
    const query = new URLSearchParams();
    if (page.before !== undefined) query.set('before', page.before);
    if (page.userId !== undefined) query.set('userId', page.userId);
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    return request<{ events: SecurityLogEntry[]; nextCursor: string | null }>('GET', `/admin/security-events${suffix}`);
  },
  accounts: async () => (await request<{ accounts: AccountInfo[] }>('GET', '/admin/accounts')).accounts,
  setAccountStatus: (userId: string, input: { status: AccountInfo['status']; password: string; code?: string }) =>
    request<{ status: AccountInfo['status']; sessionsRevoked: number }>(
      'POST',
      `/admin/accounts/${encodeURIComponent(userId)}/status`,
      input,
    ),
  workspaces: async () => (await request<{ workspaces: WorkspaceSummary[] }>('GET', '/workspaces')).workspaces,
  createWorkspace: async (name: string) =>
    (await request<{ workspace: WorkspaceSummary }>('POST', '/workspaces', { name })).workspace,
  workspace: (id: string) =>
    request<{ workspace: WorkspaceSummary; capabilities: string[]; tools: string[]; toolsRevision: number }>('GET', `/workspaces/${encodeURIComponent(id)}`),
  renameWorkspace: (id: string, name: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(id)}/rename`, { name }),
  procedures: async (workspaceId: string) =>
    (await request<{ procedures: ProcedureCard[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/procedures`)).procedures,
  home: (workspaceId: string, filter: 'ALL' | 'MINE' | 'SHARED' = 'ALL') => request<HomeOverview>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/home?filter=${filter}`),
  calendar: (workspaceId: string, from: string, to: string) =>
    request<CalendarRange>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  pinProcedure: (workspaceId: string, id: string, pinned: boolean) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/${pinned ? 'pin' : 'unpin'}`),
  createSchedule: async (workspaceId: string, input: ScheduleInput & { readonly procedureId?: string }) =>
    (await request<{ schedule: Schedule }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/schedules`, input)).schedule,
  updateSchedule: async (workspaceId: string, scheduleId: string, expectedRevision: number, input: ScheduleInput) =>
    (await request<{ schedule: Schedule }>('POST', `${schedulePath(workspaceId, scheduleId)}/update`, { expectedRevision, ...input })).schedule,
  pauseSchedule: async (workspaceId: string, scheduleId: string, expectedRevision: number) =>
    (await request<{ schedule: Schedule }>('POST', `${schedulePath(workspaceId, scheduleId)}/pause`, { expectedRevision })).schedule,
  resumeSchedule: async (workspaceId: string, scheduleId: string, expectedRevision: number, skipElapsed: boolean) =>
    (await request<{ schedule: Schedule }>('POST', `${schedulePath(workspaceId, scheduleId)}/resume`, { expectedRevision, skipElapsed })).schedule,
  endSchedule: async (workspaceId: string, scheduleId: string, expectedRevision: number) =>
    (await request<{ schedule: Schedule }>('POST', `${schedulePath(workspaceId, scheduleId)}/end`, { expectedRevision })).schedule,
  skipOlderOccurrences: async (workspaceId: string, scheduleId: string, before: string) =>
    (await request<{ skipped: number }>('POST', `${schedulePath(workspaceId, scheduleId)}/skip-older`, { before })).skipped,
  scheduleHistory: (workspaceId: string, scheduleId: string) =>
    request<{ schedule: Schedule; occurrences: OccurrenceHistoryEntry[] }>('GET', schedulePath(workspaceId, scheduleId)),
  completeOccurrence: async (workspaceId: string, id: string) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/complete`, {})).occurrence,
  reopenOccurrence: async (workspaceId: string, id: string) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/reopen`, {})).occurrence,
  skipOccurrence: async (workspaceId: string, id: string, reason: string) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/skip`, reason.trim() === '' ? {} : { reason })).occurrence,
  moveOccurrence: async (workspaceId: string, id: string, date: string, time: string | null) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/move`, { date, time })).occurrence,
  assignOccurrence: async (workspaceId: string, id: string, assigneeUserId: string | null) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/assign`, { assigneeUserId })).occurrence,
  startOccurrence: async (workspaceId: string, id: string) => (await request<{ run: RunDetail }>('POST', `${occurrencePath(workspaceId, id)}/start`)).run,
  linkableRuns: async (workspaceId: string, id: string) => (await request<{ runs: RunSummary[] }>('GET', `${occurrencePath(workspaceId, id)}/linkable-runs`)).runs,
  linkRun: async (workspaceId: string, id: string, runId: string) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/link-run`, { runId })).occurrence,
  unlinkRun: async (workspaceId: string, id: string) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/unlink-run`, {})).occurrence,
  // Optional tools of a Workspace (16.2).
  setWorkspaceTool: (workspaceId: string, tool: string, enabled: boolean, expectedRevision: number) => request<{ tools: string[]; revision: number }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/tools`, { tool, enabled, expectedRevision }),
  // Documents (16.1, 16.2).
  uploadDocumentFile,
  documentFile: async (workspaceId: string, fileId: string) => (await request<{ file: DocumentFile }>('GET', documentFilePath(workspaceId, fileId).slice('/api'.length))).file,
  documentFolders: async (workspaceId: string) => (await request<{ folders: DocumentFolder[] }>('GET', foldersPath(workspaceId))).folders,
  createDocumentFolder: async (workspaceId: string, name: string, parentId: string | null) => (await request<{ folder: DocumentFolder }>('POST', foldersPath(workspaceId), { name, parentId })).folder,
  renameDocumentFolder: async (workspaceId: string, folder: DocumentFolder, name: string) =>
    (await request<{ folder: DocumentFolder }>('POST', foldersPath(workspaceId, `/${folder.id}/rename`), { name, expectedRevision: folder.revision })).folder,
  moveDocumentFolder: async (workspaceId: string, folder: DocumentFolder, parentId: string | null) =>
    (await request<{ folder: DocumentFolder }>('POST', foldersPath(workspaceId, `/${folder.id}/move`), { parentId, expectedRevision: folder.revision })).folder,
  deleteDocumentFolder: async (workspaceId: string, folderId: string) => (await request<{ deleted: { folders: number; documents: number } }>('POST', foldersPath(workspaceId, `/${folderId}/delete`), {})).deleted,
  restoreDocumentFolder: async (workspaceId: string, folderId: string) => (await request<{ restored: RestoreOutcome }>('POST', foldersPath(workspaceId, `/${folderId}/restore`), {})).restored,
  /** `query`: the parameters of the listing as built by `listingParams` (search, filters, sort, cursor). */
  documents: (workspaceId: string, query: string) => request<DocumentListing>('GET', documentsPath(workspaceId, query === '' ? '' : `?${query}`)),
  documentFilterValues: async (workspaceId: string) => (await request<{ filters: DocumentFilterValues }>('GET', documentsPath(workspaceId, '/filters'))).filters,
  document: async (workspaceId: string, documentId: string) => (await request<{ document: DocumentDetail }>('GET', documentsPath(workspaceId, `/${encodeURIComponent(documentId)}`))).document,
  createDocument: async (workspaceId: string, folderId: string | null, fields: DocumentFields, fileIds: readonly string[]) =>
    (await request<{ document: DocumentDetail }>('POST', documentsPath(workspaceId), { ...fields, folderId, fileIds })).document,
  updateDocument: async (workspaceId: string, documentId: string, fields: DocumentFields, expectedRevision: number) =>
    (await request<{ document: DocumentDetail }>('POST', documentsPath(workspaceId, `/${documentId}/update`), { ...fields, expectedRevision })).document,
  setDocumentFiles: async (workspaceId: string, documentId: string, fileIds: readonly string[], expectedRevision: number) =>
    (await request<{ document: DocumentDetail }>('POST', documentsPath(workspaceId, `/${documentId}/files`), { fileIds, expectedRevision })).document,
  moveDocuments: async (workspaceId: string, documentIds: readonly string[], folderId: string | null) => (await request<{ moved: number }>('POST', documentsPath(workspaceId, '/move'), { documentIds, folderId })).moved,
  deleteDocument: (workspaceId: string, documentId: string) => request<undefined>('POST', documentsPath(workspaceId, `/${documentId}/delete`), {}),
  restoreDocument: async (workspaceId: string, documentId: string) => (await request<{ restored: RestoreOutcome }>('POST', documentsPath(workspaceId, `/${documentId}/restore`), {})).restored,
  // Links (16.5).
  documentLinks: (workspaceId: string, documentId: string) => request<{ links: DocumentLink[]; runs: RunLink[] }>('GET', documentsPath(workspaceId, `/${encodeURIComponent(documentId)}/links`)),
  addDocumentLink: async (workspaceId: string, documentId: string, target: { type: 'document' | 'procedure' | 'schedule' | 'contact'; id: string }) =>
    (await request<{ link: DocumentLink }>('POST', documentsPath(workspaceId, `/${encodeURIComponent(documentId)}/links`), { target })).link,
  removeDocumentLink: (workspaceId: string, linkId: string) => request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/document-links/${encodeURIComponent(linkId)}/delete`, {}),
  equipment:(workspaceId:string,query='')=>request<{records:EquipmentRecord[];nextCursor:string|null;total:number|null}>('GET',equipmentPath(workspaceId,query === '' ? '' : `?${query}`)),
  equipmentRecord:async(workspaceId:string,id:string)=>(await request<{record:EquipmentRecord}>('GET',equipmentPath(workspaceId,`/${encodeURIComponent(id)}`))).record,
  equipmentFilters:async(workspaceId:string)=>(await request<{filters:EquipmentFilters}>('GET',equipmentPath(workspaceId,'/filters'))).filters,
  createEquipment:async(workspaceId:string,input:EquipmentInput)=>(await request<{record:EquipmentRecord}>('POST',equipmentPath(workspaceId),input)).record,
  updateEquipment:async(workspaceId:string,id:string,input:EquipmentInput,expectedRevision:number)=>(await request<{record:EquipmentRecord}>('POST',equipmentPath(workspaceId,`/${encodeURIComponent(id)}/update`),{...input,expectedRevision})).record,
  deleteEquipment:(workspaceId:string,id:string)=>request<undefined>('POST',equipmentPath(workspaceId,`/${encodeURIComponent(id)}/delete`),{}),
  restoreEquipment:async(workspaceId:string,id:string)=>(await request<{record:EquipmentRecord}>('POST',equipmentPath(workspaceId,`/${encodeURIComponent(id)}/restore`),{})).record,
  equipmentTrash:async(workspaceId:string)=>(await request<{records:TrashedEquipment[]}>('GET',equipmentPath(workspaceId,'/trash'))).records,
  purgeEquipment:async(workspaceId:string,ids:readonly string[]|'all')=>(await request<{purged:number}>('POST',equipmentPath(workspaceId,'/trash/purge'),ids === 'all' ? {all:true}:{recordIds:ids})).purged,
  equipmentLinks:async(workspaceId:string,id:string)=>(await request<{links:DocumentLink[]}>('GET',equipmentPath(workspaceId,`/${encodeURIComponent(id)}/links`))).links,
  addEquipmentLink:async(workspaceId:string,id:string,target:{type:string;id:string})=>(await request<{link:DocumentLink}>('POST',equipmentPath(workspaceId,`/${encodeURIComponent(id)}/links`),{target})).link,
  removeEquipmentLink:(workspaceId:string,id:string)=>request<undefined>('POST',`/workspaces/${encodeURIComponent(workspaceId)}/equipment-links/${encodeURIComponent(id)}/delete`,{}),
  maintenanceBoard: async (workspaceId: string) => (await request<{ columns: MaintenanceColumn[] }>('GET', maintenancePath(workspaceId, '/board'))).columns,
  maintenance: (workspaceId: string, query: string) => request<{ records: MaintenanceSummary[]; nextCursor: string | null; total: number | null }>('GET', maintenancePath(workspaceId, query === '' ? '' : `?${query}`)),
  maintenanceFilters: (workspaceId: string) => request<{ filters: MaintenanceFilterValues; currencies: string[] }>('GET', maintenancePath(workspaceId, '/filters')),
  maintenanceRecord: async (workspaceId: string, recordId: string) => (await request<{ record: MaintenanceRecord }>('GET', maintenancePath(workspaceId, `/${encodeURIComponent(recordId)}`))).record,
  createMaintenance: async (workspaceId: string, input: MaintenanceInput) => (await request<{ record: MaintenanceRecord }>('POST', maintenancePath(workspaceId), input)).record,
  updateMaintenance: async (workspaceId: string, recordId: string, input: MaintenanceInput, expectedRevision: number) =>
    (await request<{ record: MaintenanceRecord }>('POST', maintenancePath(workspaceId, `/${encodeURIComponent(recordId)}/update`), { ...input, expectedRevision })).record,
  /** The one way a status changes. `completedOn`: the day the work was completed, for COMPLETED. */
  setMaintenanceStatus: async (workspaceId: string, recordId: string, status: MaintenanceStatus, expectedRevision: number, completedOn?: string) =>
    (await request<{ record: MaintenanceRecord }>('POST', maintenancePath(workspaceId, `/${encodeURIComponent(recordId)}/status`), completedOn === undefined ? { status, expectedRevision } : { status, expectedRevision, completedOn })).record,
  deleteMaintenance: (workspaceId: string, recordId: string) => request<undefined>('POST', maintenancePath(workspaceId, `/${encodeURIComponent(recordId)}/delete`), {}),
  restoreMaintenance: async (workspaceId: string, recordId: string) => (await request<{ record: MaintenanceRecord }>('POST', maintenancePath(workspaceId, `/${encodeURIComponent(recordId)}/restore`), {})).record,
  maintenanceTrash: async (workspaceId: string) => (await request<{ records: TrashedMaintenanceRecord[] }>('GET', maintenancePath(workspaceId, '/trash'))).records,
  purgeMaintenance: async (workspaceId: string, recordIds: readonly string[] | 'all') => (await request<{ purged: number }>('POST', maintenancePath(workspaceId, '/trash/purge'), recordIds === 'all' ? { all: true } : { recordIds })).purged,
  maintenanceLinks: async (workspaceId: string, recordId: string) => (await request<{ links: DocumentLink[] }>('GET', maintenancePath(workspaceId, `/${encodeURIComponent(recordId)}/links`))).links,
  addMaintenanceLink: async (workspaceId: string, recordId: string, target: { type: 'document' | 'procedure' | 'run' | 'schedule' | 'equipment'; id: string }) =>
    (await request<{ link: DocumentLink }>('POST', maintenancePath(workspaceId, `/${encodeURIComponent(recordId)}/links`), { target })).link,
  removeMaintenanceLink: (workspaceId: string, linkId: string) => request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/maintenance-links/${encodeURIComponent(linkId)}/delete`, {}),
  contacts: (workspaceId: string, query: string) => request<{ contacts: ContactSummary[]; nextCursor: string | null; total: number | null }>('GET', contactsPath(workspaceId, query === '' ? '' : `?${query}`)),
  contactCategories: async (workspaceId: string) => (await request<{ categories: string[] }>('GET', contactsPath(workspaceId, '/categories'))).categories,
  contact: (workspaceId: string, contactId: string) => request<{ contact: Contact; duplicates: ContactDuplicate[] }>('GET', contactsPath(workspaceId, `/${encodeURIComponent(contactId)}`)),
  createContact: (workspaceId: string, input: ContactInput) => request<{ contact: Contact; duplicates: ContactDuplicate[] }>('POST', contactsPath(workspaceId), input),
  updateContact: (workspaceId: string, contactId: string, input: ContactInput, expectedRevision: number) =>
    request<{ contact: Contact; duplicates: ContactDuplicate[] }>('POST', contactsPath(workspaceId, `/${encodeURIComponent(contactId)}/update`), { ...input, expectedRevision }),
  /** "Possibly the same as …" for what is being entered; changes nothing. */
  contactDuplicates: async (workspaceId: string, input: ContactInput, exceptId?: string) =>
    (await request<{ duplicates: ContactDuplicate[] }>('POST', contactsPath(workspaceId, '/duplicates'), exceptId === undefined ? input : { ...input, exceptId })).duplicates,
  deleteContact: (workspaceId: string, contactId: string) => request<undefined>('POST', contactsPath(workspaceId, `/${encodeURIComponent(contactId)}/delete`), {}),
  restoreContact: (workspaceId: string, contactId: string) => request<{ contact: Contact }>('POST', contactsPath(workspaceId, `/${encodeURIComponent(contactId)}/restore`), {}),
  contactTrash: async (workspaceId: string) => (await request<{ contacts: TrashedContact[] }>('GET', contactsPath(workspaceId, '/trash'))).contacts,
  purgeContacts: async (workspaceId: string, contactIds: readonly string[] | 'all') => (await request<{ purged: number }>('POST', contactsPath(workspaceId, '/trash/purge'), contactIds === 'all' ? { all: true } : { contactIds })).purged,
  /** Reads an import file on the server and answers what it would create. Saves nothing. */
  previewContactImport: (workspaceId: string, format: ContactFileFormat, file: Blob) => sendBytes<{ entries: ContactImportEntry[]; ignored: string[] }>(contactsPath(workspaceId, `/import/preview?format=${format}`), file),
  importContacts: async (workspaceId: string, format: ContactFileFormat, contacts: readonly ContactInput[]) => (await request<{ created: number }>('POST', contactsPath(workspaceId, '/import'), { format, contacts })).created,
  contactProcedures: async (workspaceId: string, contactId: string) => (await request<{ links: ContactProcedureLink[] }>('GET', contactsPath(workspaceId, `/${encodeURIComponent(contactId)}/procedures`))).links,
  linkContactProcedure: async (workspaceId: string, contactId: string, procedureId: string) =>
    (await request<{ link: ContactProcedureLink }>('POST', contactsPath(workspaceId, `/${encodeURIComponent(contactId)}/procedures`), { procedureId })).link,
  unlinkContactProcedure: (workspaceId: string, linkId: string) => request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/contact-links/${encodeURIComponent(linkId)}/delete`, {}),
  procedureContacts: async (workspaceId: string, procedureId: string) =>
    (await request<{ links: ProcedureContactLink[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/contact-links?procedure=${encodeURIComponent(procedureId)}`)).links,
  linkedDocuments: async (workspaceId: string, target: { type: 'procedure' | 'schedule' | 'contact'; id: string }) =>
    (await request<{ links: DocumentLink[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/document-links?${target.type}=${encodeURIComponent(target.id)}`)).links,
  runDocuments: (workspaceId: string, runId: string) =>
    request<{ documents: RunDocument[]; removals: RunDocumentRemoval[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/documents`),
  /** From a finished execution (Workspace admins): the reason is required and the confirmation explicit. */
  removeKeptRunDocument: (workspaceId: string, runId: string, runDocumentId: string, reason: string) =>
    request<{ removal: RunDocumentRemoval }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/documents/${encodeURIComponent(runDocumentId)}/remove-kept`, { reason, confirm: true }),
  linkRunDocument: async (workspaceId: string, runId: string, documentId: string) =>
    (await request<{ document: RunDocument }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/documents`, { documentId })).document,
  unlinkRunDocument: (workspaceId: string, runId: string, runDocumentId: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/documents/${encodeURIComponent(runDocumentId)}/remove`, {}),
  schedules: async (workspaceId: string) => (await request<{ schedules: Schedule[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/schedules`)).schedules,
  /** How much an export would hold (`scope` as built by `exportQuery`); refused when it is too large or one is running. */
  checkDocumentExport: async (workspaceId: string, scope: string) =>
    (await request<{ export: ExportSize }>('GET', documentsPath(workspaceId, `/export/check${scope === '' ? '' : `?${scope}`}`))).export,
  purgeDocumentTrash: async (workspaceId: string, items: readonly { kind: 'folder' | 'document'; id: string }[] | 'all') =>
    (await request<{ purged: { folders: number; documents: number; files: number } }>('POST', documentsPath(workspaceId, '/trash/purge'), items === 'all' ? { all: true } : { items })).purged,
  documentTrash: async (workspaceId: string, within: string | null) =>
    (await request<{ entries: TrashEntry[] }>('GET', documentsPath(workspaceId, `/trash${within === null ? '' : `?within=${encodeURIComponent(within)}`}`))).entries,
  documentTypes: async (workspaceId: string) => (await request<{ types: DocumentTypes }>('GET', documentTypesPath(workspaceId))).types,
  createDocumentType: (workspaceId: string, name: string) => request<unknown>('POST', documentTypesPath(workspaceId), { name }),
  renameDocumentType: (workspaceId: string, typeId: string, name: string) => request<unknown>('POST', documentTypesPath(workspaceId, `/${typeId}/rename`), { name }),
  retireDocumentType: (workspaceId: string, typeId: string) => request<unknown>('POST', documentTypesPath(workspaceId, `/${typeId}/retire`), {}),
  // Lists (15.3). Every change answers with the canonical List, items included.
  lists: async (workspaceId: string) => (await request<{ lists: ListSummary[] }>('GET', listPath(workspaceId))).lists,
  list: (workspaceId: string, listId: string) => listOf(request('GET', listPath(workspaceId, listId))),
  createList: (workspaceId: string, title: string) => listOf(request('POST', listPath(workspaceId), { title })),
  renameList: (workspaceId: string, listId: string, title: string, expectedTitle: string) => listOf(request('POST', `${listPath(workspaceId, listId)}/rename`, { title, expectedTitle })),
  deleteList: (workspaceId: string, listId: string) => listOf(request('POST', `${listPath(workspaceId, listId)}/delete`, {})),
  restoreList: (workspaceId: string, listId: string) => listOf(request('POST', `${listPath(workspaceId, listId)}/restore`, {})),
  addListItem: (workspaceId: string, listId: string, item: ListItemInput) => listOf(request('POST', `${listPath(workspaceId, listId)}/items`, item)),
  updateListItem: (workspaceId: string, listId: string, itemId: string, item: ListItemInput, expectedRevision: number) =>
    listOf(request('POST', `${listItemPath(workspaceId, listId, itemId)}/update`, { ...item, expectedRevision })),
  checkListItem: (workspaceId: string, listId: string, itemId: string, checked: boolean) => listOf(request('POST', `${listItemPath(workspaceId, listId, itemId)}/check`, { checked })),
  removeListItem: (workspaceId: string, listId: string, itemId: string) => listOf(request('POST', `${listItemPath(workspaceId, listId, itemId)}/remove`, {})),
  restoreListItem: (workspaceId: string, listId: string, itemId: string) => listOf(request('POST', `${listItemPath(workspaceId, listId, itemId)}/restore`, {})),
  procedure: async (workspaceId: string, id: string) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'GET',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}`,
      )
    ).procedure,
  createProcedure: async (workspaceId: string, content: ProcedureContent) =>
    (await request<{ procedure: ProcedureDetail }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/procedures`, content))
      .procedure,
  updateProcedure: async (workspaceId: string, id: string, expectedRevision: number, content: ProcedureContent) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'POST',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/update`,
        { ...content, expectedRevision },
      )
    ).procedure,
  deletedProcedures: async (workspaceId: string) =>
    (await request<{ procedures: DeletedProcedure[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/deleted`))
      .procedures,
  deletedProcedure: async (workspaceId: string, id: string) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'GET',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/deleted/${encodeURIComponent(id)}`,
      )
    ).procedure,
  restoreProcedure: async (workspaceId: string, id: string) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'POST',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/restore`,
      )
    ).procedure,
  exportProcedureArchive,
  importProcedureArchive: async (workspaceId: string, archive: Blob) =>
    (await sendBytes<{ procedure: ProcedureDetail }>(`/workspaces/${encodeURIComponent(workspaceId)}/procedures/import-archive`, archive)).procedure,
  exportProcedure: (workspaceId: string, id: string) =>
    request<unknown>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/export`),
  importProcedure: async (workspaceId: string, document: unknown) =>
    (await request<{ procedure: ProcedureDetail }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/import`, document))
      .procedure,
  duplicateProcedure: async (workspaceId: string, id: string) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'POST',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/duplicate`,
      )
    ).procedure,
  deleteProcedure: (workspaceId: string, id: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/delete`),
  /** Newest first; `before` = `nextCursor` of the previous page. */
  runs: (workspaceId: string, page: { state?: RunState; procedureId?: string; before?: string } = {}) => {
    const query = new URLSearchParams();
    if (page.state !== undefined) query.set('state', page.state);
    if (page.procedureId !== undefined) query.set('procedureId', page.procedureId);
    if (page.before !== undefined) query.set('before', page.before);
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    return request<{ runs: RunSummary[]; nextCursor: string | null }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/runs${suffix}`);
  },
  run: async (workspaceId: string, id: string) =>
    (await request<{ run: RunDetail }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(id)}`)).run,
  changeStepState: (
    workspaceId: string,
    runId: string,
    stepId: string,
    change: { expectedState: StepState; state: StepState; reason?: string },
    /** Only for changes made offline and sent later (8.5); `userId` is the account that made it. */
    offline?: { clientChangeId: string; userId: string; deviceTime: string },
  ) =>
    request<{ step: RunStep; runRevision: number; duplicate: boolean }>(
      'POST',
      `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/state`,
      offline === undefined ? change : { ...change, offline },
    ),
  completeRun: async (workspaceId: string, runId: string) =>
    (await request<{ run: RunDetail }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/complete`))
      .run,
  abortRun: async (workspaceId: string, runId: string, reason: string) =>
    (
      await request<{ run: RunDetail }>(
        'POST',
        `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/abort`,
        reason.trim() === '' ? {} : { reason },
      )
    ).run,
  runHistory: (workspaceId: string, runId: string, after?: string) =>
    request<HistoryPage>(
      'GET',
      `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/history${afterQuery(after)}`,
    ),
  procedureHistory: (workspaceId: string, procedureId: string, after?: string) =>
    request<HistoryPage>(
      'GET',
      `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(procedureId)}/history${afterQuery(after)}`,
    ),
  startRun: async (workspaceId: string, procedureId: string) =>
    (await request<{ run: RunDetail }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/runs`, { procedureId })).run,
  knots: async (workspaceId: string) =>
    (await request<{ knots: KnotInfo[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/knots`)).knots,
  /** The returned URL contains the token; it is shown once and never again. */
  createKnot: (
    workspaceId: string,
    input: { target: { type: KnotTargetType; id: string }; label: string; expiresInDays: number | null },
  ) => request<{ knot: KnotInfo; url: string }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/knots`, input),
  revokeKnot: (workspaceId: string, knotId: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/knots/${encodeURIComponent(knotId)}/revoke`),
  /** The token travels in the body, never in the API URL. */
  resolveKnot: (token: string) =>
    request<{ workspaceId: string; target: { type: KnotTargetType; id: string } }>('POST', '/knots/resolve', { token }),
  leaveWorkspace: (id: string) => request<undefined>('POST', `/workspaces/${encodeURIComponent(id)}/leave`),
  members: async (id: string) =>
    (await request<{ members: WorkspaceMember[] }>('GET', `/workspaces/${encodeURIComponent(id)}/members`)).members,
  addMember: (id: string, email: string, role: WorkspaceRole) =>
    request<{ member: WorkspaceMember }>('POST', `/workspaces/${encodeURIComponent(id)}/members`, { email, role }),
  changeMemberRole: (id: string, userId: string, role: WorkspaceRole) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/role`, { role }),
  removeMember: (id: string, userId: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/remove`),
  resolveInvitation: (token: string) =>
    request<{ email: string; expiresAt: string }>('POST', '/invitations/resolve', { token }),
  acceptInvitation: (token: string, displayName: string, password: string) =>
    request<{ status: 'accepted' }>('POST', '/invitations/accept', { token, displayName, password }),
};
