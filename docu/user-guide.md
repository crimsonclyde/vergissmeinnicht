# User guide

This guide is for the people who *use* VergissMeinNicht (VMN). To install and run a server, see [Deployment](deployment.md).

## The idea in one minute

- A **Procedure** is a checklist you reuse: "Leave the house", "Close the shop", "Deploy the website". It has **Sections** (e.g. *Upstairs*, *Kitchen*) with **Steps**.
- A **Run** is one time you go through a Procedure. Starting a Run takes a copy, so later edits of the Procedure never change what happened.
- Every Step of a Run is **Pending**, **Done**, **Skipped** or **Not applicable** — and the Run remembers who changed it, when, and (if asked) why.
- Everything lives in a **Workspace** (a household, a team, a shop). You only see Workspaces you were added to.

## Getting in

1. You receive an **invitation email** (VMN is invite-only). Open the link, choose a display name and a password (at least 15 characters — a sentence works well).
2. Sign in with your email address and password.
3. Recommended: open the menu (☰, top right) → **Profile & settings** → **Enable two-factor authentication**, scan the QR code with an authenticator app and **store the recovery codes** somewhere safe.

Forgot your password or lost your phone? Ask your server admin for an account recovery — a link will be emailed to you.

## Roles in a Workspace

| Role | Can |
| --- | --- |
| **Guest** | read Procedures and Runs, including their history |
| **User** | … and start, execute, complete and abort Runs |
| **Editor** | … and create, edit, import, duplicate, delete and restore Procedures; create Knot links |
| **Admin** | … and manage members, roles and the Workspace name |

## Write a Procedure (Editors)

1. **Procedures** → **New Procedure**. Give it a title, an icon and optional tags.
2. **Add section**, then **Add step to section …**. Reorder by dragging or with the move buttons.
3. Per Step:
   - **Optional** — does not block completing a Run.
   - **Critical** — must be confirmed deliberately (press and hold, or tap and confirm).
   - **More options** → when skipped / not applicable: reason *not asked*, *optional* or *required*.
4. **Create Procedure**. Edits later never touch Runs that already started.

Procedures can be exported as a `.vmn.json` file and imported into another Workspace. Deleted Procedures can be viewed and restored under **Show deleted Procedures**.

## Go through a Run

1. **Procedures** → choose one → **Start Run**.
2. The next Step to do is marked **Next**; the bar at the bottom always shows progress and **Go to next Step**.
3. For each Step: **✔ Done**, **Skip** (it applied, but was not done) or **Not applicable** (it did not apply this time). Changed your mind? **Undo**.
4. **Critical Steps** (red **!**): press and hold the button until it fills — or, if holding is hard, choose *Tap, then confirm* in **Profile & settings**.
5. When every required Step is Done or Not applicable: **Complete Run**. Plans changed? **Abort Run…** (a reason is optional).

Several people can work on the same Run at once. The **● Live** chip shows the Run updates by itself, and you see who changed what, and when.

**Show history** lists every change of the Run — who, what, when and why. Finished Runs can never be changed.

## Without a connection

Runs you opened on a device keep working when the network goes away — for example after the Step *"Turn off the router"*:

- Your changes are marked **Saved on this device · not sent yet**, and a note at the top counts them.
- When the connection is back, they are sent automatically, in order. The history shows the server time and, marked as such, the time on your device.
- If someone else changed the same Step in the meantime, your change is **not** forced through; a message tells you which one.
- Completing or aborting a Run needs a connection.
- Signing out removes everything VMN stored on the device (it asks first if changes are still waiting).

## Share a link: Knots

Editors and Admins can **Share as Knot link…** from a Procedure or Run (under **More actions**). The link opens exactly that Procedure or Run — **but only for signed-in members of the Workspace**; for anyone else it shows nothing. Links can expire and can be revoked on the **Knot links** page. The link is shown only once: copy it right away.

## Make it yours

**Profile & settings**:

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
- **This server** — hide the page footer.
