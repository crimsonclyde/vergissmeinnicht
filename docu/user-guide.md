# User guide

This guide is for the people who *use* VergissMeinNicht (VMN). To install and run a server, see [Deployment](deployment.md).

## The idea in one minute

VMN exists so you do not forget the things you have to do again and again.

- A **Procedure** is a checklist you reuse: "Leave the house", "Close the shop", "Deploy the website". It has **Sections** (e.g. *Upstairs*, *Kitchen*) with **Steps**.
- **Start** a Procedure to go through it now — or **Schedule** it for a day and get **reminders** (email, Telegram).
- Every Step is **Pending**, **Done**, **Skipped** or **Not applicable** — and VMN remembers who changed it, when, and (if asked) why. Starting takes a copy of the Procedure, so later edits never change what happened. Finished executions end up in the **Completed history**.
- Everything lives in a **Workspace** (a household, a team, a shop). You only see Workspaces you were added to.

## Getting in

1. You receive an **invitation email** (VMN is invite-only). Open the link, choose a display name and a password (at least 15 characters — a sentence of your own works well; common or leaked passwords, simple patterns and your own name or email address are refused).
2. Sign in with your email address and password.
3. Recommended: open the menu (☰, top right) → **Profile & settings** → **Enable two-factor authentication**, scan the QR code with an authenticator app and **store the recovery codes** somewhere safe.

Forgot your password or lost your phone? Ask your server admin for an account recovery — a link will be emailed to you.

## Roles in a Workspace

| Role | Can |
| --- | --- |
| **Guest** | read Procedures, scheduled items and the completed history |
| **User** | … and start, schedule, execute, complete and abort Procedures |
| **Editor** | … and create, edit, import, duplicate, delete and restore Procedures; create Knot links |
| **Admin** | … and manage members, roles and the Workspace name |

## Write a Procedure (Editors)

1. **Procedures** → **New Procedure**. Give it a title, an icon and optional tags. The icon picker suggests common icons; search by name or everyday words (*plug*, *fan*, *radiator*, *bin*, *fridge*, …; best matches first), pick a **Category**, or **Browse all** (several hundred icons, by topic).
2. **Add section**, then **Add step to section …**. Reorder by dragging or with the move buttons.
3. Per Step:
   - **Optional** — does not block completing.
   - **Critical** — must be confirmed deliberately (press and hold, or tap and confirm).
   - **More options** → when skipped / not applicable: reason *not asked*, *optional* or *required*.
4. **Create Procedure**. Edits later never touch executions that already started.

Procedures can be exported as a `.vmn.json` file and imported into another Workspace (**⋯ Manage Procedures → Import Procedure**). Deleted Procedures can be viewed and restored under **⋯ Manage Procedures → Deleted Procedures**.

## Home

Opening a Workspace shows its **Home** — small on purpose:

- **Due** — scheduled Procedures for today and overdue ones, with **Start**.
- **Upcoming** — what is scheduled later, with its reminders. **Start early** if you like; **⋯** → *Reschedule…* or *Cancel this schedule*.
- **Active** — what is being done right now, by whom, with **Continue**.
- **Pinned** — your ★ Procedures (only for you).
- **Recent** — Procedures you started lately (opening one does not count).

## Start or schedule a Procedure

On **Procedures**, every Procedure has **Start** right in the list (no need to open it first):

- **Start now** — begins at once. If the Procedure is already being done, VMN says so (*"… started by Jane 18 minutes ago"*) and offers **Continue existing** or **Start another anyway**.
- **Schedule…** — choose a date, optionally a time, and when to be reminded: *on the day*, *1 day before*, *1 week before* or your own (1–48 hours or 0–30 days before, up to 5). Nothing starts by itself: on the day it appears under **Due**, and you press **Start**. If the Procedure is deleted in the meantime, the scheduled item says so and can no longer be started.
- **★** pins a Procedure (Home and first in the list — only for you). **⋯** holds the rest: Edit, Duplicate, Export, Share as Knot link, History, Delete.

Reminders go to the person who scheduled it, through the channels switched on under **Profile & settings → Notifications**. They contain the Procedure's title, the date and the Workspace name, and a link that still asks you to sign in.

## Go through a Procedure

1. **Start** it (or **Continue** on Home).
2. The next Step to do is marked **Next**; the bar at the bottom always shows progress and **Go to next Step**.
3. For each Step: **✔ Done**, **Skip** (it applied, but was not done) or **Not applicable** (it did not apply this time). Changed your mind? **Undo**.
4. **Critical Steps** (red **!**): press and hold the button until it fills — or, if holding is hard, choose *Tap, then confirm* in **Profile & settings**.
5. When every required Step is Done or Not applicable: **Complete**. Plans changed? **Abort…** (a reason is optional).

Several people can work on the same execution at once. The **● Live** chip shows it updates by itself, and you see who changed what, and when.

**History** (folded away below the Steps) lists every change — who, what, when and why. Finished executions are in the **Completed history** and can never be changed.

## Without a connection

Executions you opened on a device keep working when the network goes away — for example after the Step *"Turn off the router"*:

- Your changes are marked **Saved on this device · not sent yet**, and a note at the top counts them.
- When the connection is back, they are sent automatically, in order. The history shows the server time and, marked as such, the time on your device.
- If someone else changed the same Step in the meantime, your change is **not** forced through; a message tells you which one.
- Completing or aborting needs a connection.
- Signing out removes everything VMN stored on the device (it asks first if changes are still waiting) — also for other open VMN tabs, which go back to the sign-in page. If the browser cannot remove it, VMN tells you; then close every VMN tab and clear this site's data in the browser settings.

## Share a link: Knots

Editors and Admins can **Share as Knot link…** from a Procedure (under **⋯**) or an execution (under *History and sharing*). The link opens exactly that Procedure or execution — **but only for signed-in members of the Workspace**; for anyone else it shows nothing. Links can expire and can be revoked on the **Knot links** page. The link is shown only once: copy it right away.

## Make it yours

**Profile & settings**:

- **Notifications** — your default reminder time (09:00 unless you change it), email reminders on/off, and Telegram. Once your server admin has set up a Telegram bot, connect **your own** chat: **Connect Telegram** → open the link in Telegram and press *Start* → come back (the page notices it by itself) → **Confirm** the chat (only if it is yours — otherwise *Not me*) → connected, shown with your Telegram name. You never type a chat ID. *Disconnect Telegram* stops it at any time.
- **Appearance** — System, Light, Dark or **Memento Mori** (pure black with crimson accents). Saved to your account, so it follows you to every device.
- **Critical Steps** — press and hold, or tap then confirm.
- **Password** and **Two-factor authentication**.

## For server admins

**Menu → Server admin**:

- **Create a Workspace** (you become its admin and add members on the **Members** page).
- **Invitations** — invite people by email, send again, revoke.
- **Accounts** — disable an account (signs the person out everywhere at once) or enable it again.
- **Account recovery** — email a recovery link for a forgotten password or a lost authenticator.
- **Security log** — sign-ins, two-factor, recovery, invitations, account and membership changes.
- **This server** — hide the page footer; how many **Recent** Procedures Home shows (0–20, 0 hides the section).
- **Notification providers** — email reminders on/off and a test email to yourself; **Telegram**: paste the **Bot token** from @BotFather (checked with Telegram, stored encrypted, never shown again) and enable it — this sets up the bot for the whole server, not a destination chat. Then, like everyone else, connect your own chat under *Profile & settings → Notifications* (**Go to my notification settings**); only after that can **Send test message to my Telegram** reach you. You can also remove the token. See [Deployment](deployment.md#reminders-and-notification-providers).
