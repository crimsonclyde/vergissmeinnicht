# User guide

This guide is for the people who *use* VergissMeinNicht (VMN). To install and run a server, see [Deployment](deployment.md).

## The idea in one minute

VMN exists so you do not forget the things you have to do again and again.

- A **Procedure** is a checklist you reuse: "Leave the house", "Close the shop", "Deploy the website". It has **Sections** (e.g. *Upstairs*, *Kitchen*) with **Steps**.
- **Start** a Procedure to go through it now — or **Schedule** it (once or repeating) and get **reminders** (email, Telegram).
- Keep simple obligations — like paying the annual tax — as **Reminders**, with or without repetition, and mark them done.
- Keep the shopping in a **Grocery list** that everyone in the Workspace sees: add what is needed, tick what is bought.
- Every Step is **Pending**, **Done**, **Skipped** or **Not applicable** — and VMN remembers who changed it, when, and (if asked) why. Starting takes a copy of the Procedure, so later edits never change what happened. Finished executions end up in the **Completed history**.
- Everything lives in a **Workspace** (a household, a team, a shop). You only see Workspaces you were added to.

## Finding your way: the tools

VMN is organised around what you want to do. Choose a tool and it has the screen to itself:

- **Today** — what needs you now: unfinished executions, what is overdue, what is due today.
- **Procedures** — the reusable checklists: start, schedule, write and change them.
- **Reminders** — single things to remember, with a date.
- **Lists** — grocery lists.
- **Calendar** — an optional look ahead, by month or as an agenda.

On a computer the tools are in the bar on the left, with the Workspace above them and **Settings** at the bottom. On a phone the Workspace and the **Settings** button (⚙) are at the top, and four destinations are at the bottom: **Today**, **Procedures**, **Lists** and **More** — More leads to Reminders, the Calendar and the completed history. Addresses from before still work (bookmarks, Knot links, links in reminder messages).

**Settings** has three areas, each split into named sections so you never scroll past unrelated forms: **Profile & settings** (yours), **Workspace settings** (name, members, sharing links — what you see depends on your role) and **Server admin** (server admins only). **Sign out** is in the same menu.

## Getting in

1. You receive an **invitation email** (VMN is invite-only). Open the link, choose a display name and a password (at least 15 characters — a sentence of your own works well; common or leaked passwords, simple patterns and your own name or email address are refused).
2. Sign in with your email address and password.
3. Recommended: **Settings** → **Profile & settings** → **Password & security** → **Enable two-factor authentication**, scan the QR code with an authenticator app and **store the recovery codes** somewhere safe.

Forgot your password or lost your phone? Ask your server admin for an account recovery — a link will be emailed to you.

## Roles in a Workspace

| Role | Can |
| --- | --- |
| **Guest** | read Procedures, schedules, Reminders, Lists and the completed history |
| **User** | … and start, schedule, execute, complete and abort Procedures; create, complete and skip Reminders; assign who is responsible; create and change grocery lists |
| **Editor** | … and create, edit, import, duplicate, delete and restore Procedures; create Knot links |
| **Admin** | … and manage members, roles and the Workspace name |

## Write a Procedure (Editors)

**Today → Add → Procedure**, or **Procedures → New Procedure**, opens the builder. It is one screen, not a wizard — and a Procedure needs no date.

1. **Name it.**
2. **Type the steps.** There is already a section called *Steps*: type a step title into **Add a step…** and press Enter — the field is ready for the next one. **Paste multiple steps** takes a list (one step per line; bullets and numbers are removed) and shows what will be added before you confirm; a line that is too long, or more steps than fit (200 per Procedure), is named instead of being cut.
3. **Refine only what needs it.** Open a step to edit it — next to the outline on a computer, as its own screen on a phone:
   - **Instructions** (optional) and an optional **icon**.
   - **Instruction image** (optional, one per step): **Take photo** opens the camera on a phone, **Choose photo** picks a file. A **caption is required** — say what the photo shows (e.g. *Blue lever left of the water meter*); it is shown with the photo and read out by screen readers. Write the step so it also works without the photo.
   - **Required** (on for new steps) — the step must be done or marked not applicable before the execution can be completed. Off = optional.
   - **Critical** (off for new steps) — must be confirmed deliberately (press and hold, or tap and confirm).
   - **Advanced rules** — whether a reason is *not asked*, *optional* (the default) or *required* when the step is skipped or marked not applicable.
   - **Apply step** puts your changes into the outline. **Cancel** discards only what you had not applied.
4. **Preview** shows how it will look while executing. It starts nothing, sends nothing and writes no history.
5. **Save procedure.** Nothing is stored before that — there is no autosave. The builder always says where you are: *Step has unapplied changes*, *Unsaved changes*, *Saving…* or *Saved*. While a step has unapplied changes, Save waits until you apply or cancel them. Leaving with unsaved changes asks first. After saving, **Start** (*Start now* / *Schedule…*) is right there.

More in the outline: each step has **⋯** with *Edit*, *Duplicate*, *Move up/down*, *Move to another section…* and *Delete*; every one of these — and pasting — can be taken back with **Undo**. On a computer you can also drag steps (onto another step, or onto a section) and drag sections. **Add section** adds one; a section's **⋯** renames or describes it, moves it, or removes it — removing a section with steps asks first, and Undo brings it back. **Details** (under the name) holds the description, the Procedure's icon and tags. The icon picker suggests common icons; search by name or everyday words (*plug*, *fan*, *radiator*, *bin*, *fridge*, …; best matches first), pick a **Category**, or **Browse all**.

If someone else saved the same Procedure while you were editing, your save is refused with a message — nothing is overwritten. You can keep your screen as it is, or **Load the latest version**. Edits never touch executions that already started: those keep the steps (and photos) they started with.

Procedures can be exported as a `.vmn.json` file (**Export as JSON** — without photos) or as a `.vmn.zip` archive **with** photos (**Export as archive**), and imported into another Workspace (**⋯ Manage Procedures → Import Procedure**; both kinds of file).

**Photos in detail:** JPEG, PNG and WebP up to 10 MB. VMN stores a copy of at most 1600 pixels as JPEG, turned upright, with all hidden information removed (location, camera, time). iPhone photos (HEIC) are converted by the browser before they are sent (Safari and other iPhone browsers); if a browser cannot do that, VMN says so — then set *Settings → Camera → Formats → Most Compatible* or share the photo as JPEG. Each Workspace has photo storage (100 MB unless a server admin chose more); the editor shows how much is used. When it is full, new photos are refused — existing ones stay. Deleted Procedures can be viewed and restored under **⋯ Manage Procedures → Deleted Procedures**.

## Today

Opening a Workspace shows **Today** — only what needs you now, one clear action per card:

- **Continue** — executions that are not finished, with how far they are and **Continue**.
- **Needs attention** — dates that have passed and are not done yet (marked **Overdue**). They stay until you complete or skip them; nothing is marked done by itself. If a repeating item is overdue several times, it is shown once ("3 overdue") with **⋯ → Skip the older ones…**.
- **Due today** — a Reminder offers **Done**, a Procedure **Start**.
- **To buy** — grocery lists that still have something on them, with **Open list**.
- Each card shows the title and one line: when it is due and who is responsible (**Assigned to …** or **Shared**). **⋯** holds the rest: *Details* (Reminder or Procedure, how it repeats, its reminders), *Skip…* (with an optional reason), *Move this date…*, *Assign…*, *Link an execution…*, *Edit schedule…*, *Pause* / *Resume*, *End schedule…*.
- After **Done** a notice offers **Undo**.
- **All / Assigned to me / Shared** appears when something is assigned to someone, and filters the cards (remembered in this browser).
- Upcoming dates, what was completed, and the Procedures themselves are not on Today — the links at the bottom lead to the **Calendar** (with the number of upcoming dates), **Reminders**, **All Procedures** and the **Completed history**.

**Add** (top right) offers **Procedure** — reusable steps, **Reminder** — remember one thing, and **Grocery list** — quick shared shopping, and opens what you chose at once. You only see what your role may create.

## Reminders

**Reminders** lists the standalone Reminders: overdue, today and the next 90 days, each with **Done**; **Recently done** (folded away) shows what was completed or skipped in the last day and by whom, with **Undo**. **New reminder** asks for what and when first; **Notes**, **Repeat**, **Responsible** and **Reminders** (the notifications) are folded behind lines that show their current value — once, shared, and a reminder on the due date unless you change them. Scheduled Procedures are not listed here: they are on Today when due, on their Procedure, and in the Calendar.

## Grocery lists

**Lists** holds the Workspace's grocery lists — shared with everyone in it. A list is not a Procedure: nothing to start, no required or critical steps, no skipping.

- **New list** (or **Add → Grocery list**): give it a name.
- **Add an item**: what, and optionally a quantity (a number such as 2 or 1.5) and a unit (*kg*, *l*, *packs*). Enter adds it and the field is ready for the next item.
- **Tick** an item when it is bought. It moves to **Purchased** (folded away, with who bought it); untick it there to buy it again. Two people ticking the same item is fine.
- **⋯** on an item: *Edit…* or *Remove*. After ticking, unticking or removing, **Undo** takes it back.
- **⋯** next to the list's name: *Rename list…* or *Delete list* (Undo right afterwards).
- Changes by others appear within about ten seconds. If someone else edited the same item just before you, your edit is refused with a message instead of replacing theirs. Lists need a connection.
- Guests can read lists; Users, Editors and Admins can change them. A Workspace can have 100 lists with up to 300 items each.

## Calendar

**Calendar** is the optional planning view: one month at a time, with everything that has a date — also what is upcoming and what was done:

- **Month** shows the days with what is on them; choose a day to see its entries below, with the same actions as on Today (**Done**, **Start**, **Start early**, **Continue**, **⋯**, **Undo**). **Agenda** lists the same month day by day and is what a phone shows first. Your choice is remembered in this browser.
- Every entry carries a sign and a word: ○ open, ! overdue, ▶ in progress, ✓ completed, ↷ skipped (with who did it and when), and ◌ **Planned**.
- **Planned** entries are the future dates of something that repeats on fixed dates — also years ahead. They show what is coming; they can be completed once their turn has come and they appear on Today and under Reminders. Things that repeat *after they are done* have no planned dates, because the next date depends on when you finish.
- **‹ ›** change the month, **Today** returns. With the keyboard: the arrow keys move between days, Page Up / Page Down between months.
- **Filters** (folded away until you need them): open / overdue / completed / skipped, who is responsible, and Reminders or Procedures. They combine, and they are remembered in this browser.

The calendar only shows and lets you act; there is no dragging of entries and no connection to other calendars.

## Reminders and repeating schedules

A **Reminder** is something to remember without steps (a title and optional notes); a **scheduled Procedure** is a Procedure with a date. Both can repeat:

- **Once** — one date.
- **On fixed dates** — every N days, weeks (optionally on chosen weekdays), months (optionally on the last day) or years. Dates stay fixed even when one is done late; a day that does not exist in a month (the 31st, 29 February) moves to that month's last day and the next one returns to it.
- **After it is done** — every N days/weeks/months/years counted from the day it was completed (or skipped).

Every date is its own entry: completing last year's never completes this year's. **Responsible** (optional) names who is expected to do it and who gets the reminders; it grants no extra rights, and anyone allowed to execute may complete it (VMN records who actually did). **Pause** stops new dates and reminders; **Resume** offers to skip the dates that fell into the pause. **End** keeps the history.

Reminders can come *on the due date*, *N days/weeks/months before* (at your default reminder time) or *N hours before* a timed date — up to 5. They go to the responsible person, otherwise to whoever created the schedule. If VMN was unavailable when a reminder was due and it is more than a day late, you get **one short summary** of what was missed ("Missed reminders: …") describing each item's current date and status — never a flood of old messages. Today, Reminders and the Calendar are always the reliable overview, whether a message arrived or not.

## Start or schedule a Procedure

On **Procedures**, every Procedure has **Start** right in the list (no need to open it first):

- **Start now** — begins at once. If the Procedure is already being done, VMN says so (*"… started by Jane 18 minutes ago"*) and offers **Continue existing** or **Start another anyway**.
- **Schedule…** — choose once or a repetition, a date, optionally a time, who is responsible, and when to be reminded (see *Reminders and repeating schedules*). Nothing starts by itself: on the day it appears under **Today**, and you press **Start**. If the Procedure is deleted in the meantime, its dates say so and can no longer be started.
- **⋯** holds the rest: Edit, *Pin to the top* (only for you — a ★ marks it), Duplicate, Export, Share as Knot link, History, Delete. **Recently used** above the list links to the Procedures you started lately.

Reminders go to the responsible person, otherwise to the person who scheduled it, through the channels switched on under **Profile & settings → Notifications**. They contain the title, the date and the Workspace name, and a link that still asks you to sign in.

## Go through a Procedure

1. **Start** it (or **Continue** on Today).
2. The next Step to do is marked **Next**; the bar at the bottom always shows progress and **Go to next Step**. On a phone the bottom navigation steps aside while you execute; **← Today** leads back.
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

Editors and Admins can **Share as Knot link…** from a Procedure (under **⋯**) or an execution (under *History and sharing*). The link opens exactly that Procedure or execution — **but only for signed-in members of the Workspace**; for anyone else it shows nothing. Links can expire and can be revoked under **Settings → Workspace settings → Sharing links**. The link is shown only once: copy it right away.

## Make it yours

**Settings → Profile & settings**, one section at a time:

- **Notifications** — your default reminder time (09:00 unless you change it), email reminders on/off, and Telegram. Once your server admin has set up a Telegram bot, connect **your own** chat: **Connect Telegram** → open the link in Telegram and press *Start* → come back (the page notices it by itself) → **Confirm** the chat (only if it is yours — otherwise *Not me*) → connected, shown with your Telegram name. You never type a chat ID. *Disconnect Telegram* stops it at any time.
- **Appearance** — System (follows your device, also when it changes), Light, Dark or **Memento Mori** (pure black with crimson accents). Light and Dark look and work the same; only the colours differ. Saved to your account, so it follows you to every device.
- **Password & security** — change your password; two-factor authentication.
- **Confirmations** — how critical Steps are confirmed: press and hold, or tap then confirm.

## Workspace settings

**Settings → Workspace settings**:

- **General** — the Workspace's name (Admins can change it), your role, and **Leave Workspace**.
- **Members** — who is in the Workspace and their role; Admins add members, change roles and remove members.
- **Sharing links** (Editors and Admins) — every Knot link, with **Revoke**.

## For server admins

**Settings → Server admin** (only shown to server admins), one section at a time:

- **Workspaces** — create a Workspace (you become its admin and add members under *Workspace settings → Members*).
- **Invitations** — invite people by email, send again, revoke.
- **Accounts & recovery** — disable an account (signs the person out everywhere at once) or enable it again; email a recovery link for a forgotten password or a lost authenticator.
- **Notification providers** — email reminders on/off and a test email to yourself; **Telegram**: paste the **Bot token** from @BotFather (checked with Telegram, stored encrypted, never shown again) and enable it — this sets up the bot for the whole server, not a destination chat. Then, like everyone else, connect your own chat under *Profile & settings → Notifications* (**Go to my notification settings**); only after that can **Send test message to my Telegram** reach you. You can also remove the token. See [Deployment](deployment.md#reminders-and-notification-providers).
- **Server & storage** — hide the page footer; how many **Recently used** Procedures the Procedures page shows (0–20, 0 hides them); **photo storage**: how much each Workspace uses, and its limit: 100 MB, 250 MB, 500 MB or 1 GB. Lowering a limit never deletes photos; new ones are refused until usage is below it.
- **Security log** — sign-ins, two-factor, recovery, invitations, account and membership changes.
