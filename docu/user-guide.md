# User guide

This guide is for the people who *use* VergissMeinNicht (VMN). To install and run a server, see [Deployment](deployment.md).

## The idea in one minute

VMN exists so you do not forget the things you have to do again and again.

- A **Procedure** is a checklist you reuse: "Leave the house", "Close the shop", "Deploy the website". It has **Sections** (e.g. *Upstairs*, *Kitchen*) with **Steps**.
- **Start** a Procedure to go through it now — or **Schedule** it (once or repeating) and get **reminders** (email, Telegram).
- Keep simple obligations — like paying the annual tax — as **Reminders**, with or without repetition, and mark them done.
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
| **Guest** | read Procedures, schedules, Reminders and the completed history |
| **User** | … and start, schedule, execute, complete and abort Procedures; create, complete and skip Reminders; assign who is responsible |
| **Editor** | … and create, edit, import, duplicate, delete and restore Procedures; create Knot links |
| **Admin** | … and manage members, roles and the Workspace name |

## Write a Procedure (Editors)

1. **Procedures** → **New Procedure**. Give it a title, an icon and optional tags. The icon picker suggests common icons; search by name or everyday words (*plug*, *fan*, *radiator*, *bin*, *fridge*, …; best matches first), pick a **Category**, or **Browse all** (several hundred icons, by topic).
2. **Add section**, then **Add step to section …**. Reorder by dragging or with the move buttons.
3. Per Step:
   - **Optional** — does not block completing.
   - **Critical** — must be confirmed deliberately (press and hold, or tap and confirm).
   - **More options** → when skipped / not applicable: reason *not asked*, *optional* or *required*.
   - **A photo** (optional, one per Step): **Take photo** opens the camera on a phone, **Choose photo** picks a file. Describe what it shows (e.g. *Blue lever left of the water meter*) — the description is shown with the photo and read out by screen readers. Write the Step so it also works without the photo. **Replace photo** / **Remove photo** change it; executions that already started keep the photo they started with.
4. **Create Procedure**. Edits later never touch executions that already started.

Procedures can be exported as a `.vmn.json` file (**Export as JSON** — without photos) or as a `.vmn.zip` archive **with** photos (**Export as archive**), and imported into another Workspace (**⋯ Manage Procedures → Import Procedure**; both kinds of file).

**Photos in detail:** JPEG, PNG and WebP up to 10 MB. VMN stores a copy of at most 1600 pixels as JPEG, turned upright, with all hidden information removed (location, camera, time). iPhone photos (HEIC) are converted by the browser before they are sent (Safari and other iPhone browsers); if a browser cannot do that, VMN says so — then set *Settings → Camera → Formats → Most Compatible* or share the photo as JPEG. Each Workspace has photo storage (100 MB unless a server admin chose more); the editor shows how much is used. When it is full, new photos are refused — existing ones stay. Deleted Procedures can be viewed and restored under **⋯ Manage Procedures → Deleted Procedures**.

## Home

Opening a Workspace shows its **Home** — what needs attention, one clear action per line:

- **Overdue** — dates that have passed and are not done yet. They stay until you complete or skip them; nothing is marked done by itself. If a repeating item is overdue several times, it is shown once ("3 overdue") with **⋯ → Skip the older ones…**.
- **Today** and **Upcoming** (the next 90 days) — each line says whether it is a **Reminder** or a **Procedure**, when it is due, who is responsible (**Assigned to …** or **Shared**) and offers the next step: **Complete** for a Reminder, **Start** (or **Start early**) for a Procedure, **Continue** when it is already being done.
- **⋯** on a line: *Skip…* (with an optional reason — for a series that repeats after completion it tells you the next date first), *Move this date…*, *Assign…* (this date only), *Link an execution…* (count an execution that was already done for this date), *Edit schedule…*, *Pause* / *Resume*, *End schedule…*.
- **Recently done** — what was completed or skipped in the last day, and **by whom**; **Undo** reopens a Reminder.
- **Active** — what is being done right now, by whom, with **Continue**.
- **Pinned** — your ★ Procedures (only for you). **Recent** — Procedures you started lately.
- **All / Assigned to me / Shared** filters the lists (remembered in this browser). **New reminder** creates a standalone Reminder.

## Calendar

**Calendar** (next to Home) shows one month at a time — everything Home knows, on its date:

- **Month** shows the days with what is on them; choose a day to see its entries below, with the same actions as on Home (**Complete**, **Start**, **Continue**, **⋯**, **Undo**). **Agenda** lists the same month day by day and is what a phone shows first. Your choice is remembered in this browser.
- Every entry carries a sign and a word: ○ open, ! overdue, ▶ in progress, ✓ completed, ↷ skipped (with who did it and when), and ◌ **Planned**.
- **Planned** entries are the future dates of something that repeats on fixed dates — also years ahead. They show what is coming; they can be completed once their turn has come and they appear on Home. Things that repeat *after they are done* have no planned dates, because the next date depends on when you finish.
- **‹ ›** change the month, **Today** returns. With the keyboard: the arrow keys move between days, Page Up / Page Down between months.
- **Filters** (folded away until you need them): open / overdue / completed / skipped, who is responsible, and Reminders or Procedures. They combine, and they are remembered in this browser.

The calendar only shows and lets you act; there is no dragging of entries and no connection to other calendars.

## Reminders and repeating schedules

A **Reminder** is something to remember without steps (a title and optional notes); a **scheduled Procedure** is a Procedure with a date. Both can repeat:

- **Once** — one date.
- **On fixed dates** — every N days, weeks (optionally on chosen weekdays), months (optionally on the last day) or years. Dates stay fixed even when one is done late; a day that does not exist in a month (the 31st, 29 February) moves to that month's last day and the next one returns to it.
- **After it is done** — every N days/weeks/months/years counted from the day it was completed (or skipped).

Every date is its own entry: completing last year's never completes this year's. **Responsible** (optional) names who is expected to do it and who gets the reminders; it grants no extra rights, and anyone allowed to execute may complete it (VMN records who actually did). **Pause** stops new dates and reminders; **Resume** offers to skip the dates that fell into the pause. **End** keeps the history.

Reminders can come *on the due date*, *N days/weeks/months before* (at your default reminder time) or *N hours before* a timed date — up to 5. They go to the responsible person, otherwise to whoever created the schedule. If VMN was unavailable when a reminder was due and it is more than a day late, you get **one short summary** of what was missed ("Missed reminders: …") describing each item's current date and status — never a flood of old messages. The Home page is always the reliable overview, whether a message arrived or not.

## Start or schedule a Procedure

On **Procedures**, every Procedure has **Start** right in the list (no need to open it first):

- **Start now** — begins at once. If the Procedure is already being done, VMN says so (*"… started by Jane 18 minutes ago"*) and offers **Continue existing** or **Start another anyway**.
- **Schedule…** — choose once or a repetition, a date, optionally a time, who is responsible, and when to be reminded (see *Reminders and repeating schedules*). Nothing starts by itself: on the day it appears under **Today**, and you press **Start**. If the Procedure is deleted in the meantime, its dates say so and can no longer be started.
- **★** pins a Procedure (Home and first in the list — only for you). **⋯** holds the rest: Edit, Duplicate, Export, Share as Knot link, History, Delete.

Reminders go to the responsible person, otherwise to the person who scheduled it, through the channels switched on under **Profile & settings → Notifications**. They contain the title, the date and the Workspace name, and a link that still asks you to sign in.

## Go through a Procedure

1. **Start** it (or **Continue** on Home).
2. The next Step to do is marked **Next**; the bar at the bottom always shows progress and **Go to next Step**.
3. For each Step: **✔ Done**, **Skip** (it applied, but was not done) or **Not applicable** (it did not apply this time). Changed your mind? **Undo**.
4. A Step with a photo shows it small next to the Step; tap it to see it full-screen (**Close**, Escape or Back to return).
5. **Critical Steps** (red **!**): press and hold the button until it fills — or, if holding is hard, choose *Tap, then confirm* in **Profile & settings**.
6. When every required Step is Done or Not applicable: **Complete**. Plans changed? **Abort…** (a reason is optional).

Several people can work on the same execution at once. The **● Live** chip shows it updates by itself, and you see who changed what, and when.

**History** (folded away below the Steps) lists every change — who, what, when and why. Finished executions are in the **Completed history** and can never be changed.

## Without a connection

Executions you opened on a device keep working when the network goes away — for example after the Step *"Turn off the router"*:

- Your changes are marked **Saved on this device · not sent yet**, and a note at the top counts them.
- When the connection is back, they are sent automatically, in order. The history shows the server time and, marked as such, the time on your device.
- If someone else changed the same Step in the meantime, your change is **not** forced through; a message tells you which one.
- Completing or aborting needs a connection.
- Photos of Steps are kept with the execution on the device once they have been shown; a photo that is not there shows *Image not available offline* with its description.
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
- **Photo storage** — how much each Workspace uses, and its limit: 100 MB, 250 MB, 500 MB or 1 GB. Lowering a limit never deletes photos; new ones are refused until usage is below it.
- **This server** — hide the page footer; how many **Recent** Procedures Home shows (0–20, 0 hides the section).
- **Notification providers** — email reminders on/off and a test email to yourself; **Telegram**: paste the **Bot token** from @BotFather (checked with Telegram, stored encrypted, never shown again) and enable it — this sets up the bot for the whole server, not a destination chat. Then, like everyone else, connect your own chat under *Profile & settings → Notifications* (**Go to my notification settings**); only after that can **Send test message to my Telegram** reach you. You can also remove the token. See [Deployment](deployment.md#reminders-and-notification-providers).
