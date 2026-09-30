/**
 * Texts of the emails the server sends (Step 8.9, server side of 8.4). A translation is another
 * object of this type; the use-cases never contain wording. Emails are plain text (never HTML);
 * times are ISO 8601 so they are unambiguous in every language and time zone.
 */
export interface EmailTexts {
  readonly invitation: {
    readonly subject: string;
    readonly body: (input: { readonly email: string; readonly inviterName: string | undefined; readonly url: string; readonly expiresAt: string }) => string;
  };
  readonly recovery: {
    readonly subject: string;
    readonly body: (input: {
      readonly displayName: string;
      readonly adminName: string;
      readonly resetPassword: boolean;
      readonly resetTotp: boolean;
      readonly url: string;
      readonly expiresAt: string;
    }) => string;
  };
  /** A reminder of a Reminder or scheduled Procedure (13.6, 14.1); the same wording is used for Telegram (13.7). */
  readonly reminder: {
    readonly subject: (input: ReminderTextInput) => string;
    readonly body: (input: ReminderTextInput) => string;
  };
  /**
   * Catch-up after an outage (D5): one bounded summary of reminders that could not be sent on time.
   * Describes each item's *current* due date and status — never the original offset.
   */
  readonly catchUp: {
    readonly subject: (input: CatchUpTextInput) => string;
    readonly body: (input: CatchUpTextInput) => string;
  };
  /** Test message sent by a server admin to check a provider (13.10 admin). */
  readonly providerTest: { readonly subject: string; readonly body: (input: { readonly provider: string }) => string };
}

export interface ReminderTextInput {
  readonly kind: 'REMINDER' | 'PROCEDURE';
  /** The Reminder's or Procedure's title. */
  readonly title: string;
  readonly workspaceName: string;
  /** `YYYY-MM-DD` and optional `HH:MM`, in `timeZone`. */
  readonly date: string;
  readonly time: string | null;
  readonly timeZone: string;
  /** Calendar days from today (in `timeZone`) to the due date; negative when overdue. */
  readonly daysUntil: number;
  /** Whole hours until a timed Occurrence is due, when that is less than a day away; otherwise null. */
  readonly hoursUntil: number | null;
  readonly url: string;
}

export interface CatchUpTextInput {
  /** The items shown (at most 10), earliest due first. */
  readonly items: readonly Omit<ReminderTextInput, 'url'>[];
  /** Further items not listed. */
  readonly more: number;
  readonly url: string;
}
