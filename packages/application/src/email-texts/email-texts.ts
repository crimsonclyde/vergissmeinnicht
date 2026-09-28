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
}
