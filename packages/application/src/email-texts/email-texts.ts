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
  /** A reminder of a scheduled Procedure (13.6); the same wording is used for Telegram (13.7). */
  readonly reminder: {
    readonly subject: (input: ReminderTextInput) => string;
    readonly body: (input: ReminderTextInput) => string;
  };
  /** Test message sent by a server admin to check a provider (13.10 admin). */
  readonly providerTest: { readonly subject: string; readonly body: (input: { readonly provider: string }) => string };
}

export interface ReminderTextInput {
  readonly procedureTitle: string;
  readonly workspaceName: string;
  /** `YYYY-MM-DD` and optional `HH:MM`, in `timeZone`. */
  readonly date: string;
  readonly time: string | null;
  readonly timeZone: string;
  /** `DAYS:7`, `HOURS:2`, … */
  readonly reminderKey: string;
  readonly overdue: boolean;
  readonly url: string;
}
