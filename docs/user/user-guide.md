# User guide

This guide is for the people who *use* VergissMeinNicht (VMN). To install and run a server, see [Deployment](../admin/deployment.md).

## The idea in one minute

VMN exists so you do not forget the things you have to do again and again.

- A **Procedure** is a checklist you reuse: "Leave the house", "Close the shop", "Deploy the website". It has **Sections** (e.g. *Upstairs*, *Kitchen*) with **Steps**.
- **Start** a Procedure to go through it now — or **Schedule** it (once or repeating) and get **reminders** (email, Telegram).
- Keep simple obligations — like paying the annual tax — as **Reminders**, with or without repetition, and mark them done.
- Use a shared **Shopping** list for groceries or a **To-do** list for everyday tasks.
- Every Step is **Pending**, **Done**, **Skipped** or **Not applicable** — and VMN remembers who changed it, when, and (if asked) why. Starting takes a copy of the Procedure, so later edits never change what happened. Finished executions end up in the **Completed history**.
- Everything lives in a **Workspace** (a household, a team, a shop). You only see Workspaces you were added to.

## Finding your way: the tools

VMN is organised around what you want to do. Choose a tool and it has the screen to itself:

- **Dashboard** — progress and next actions: recent completions, unfinished executions, what is overdue and due today.
- **Procedures** — the reusable checklists: start, schedule, write and change them.
- **Reminders** — single things to remember, with a date.
- **Lists** — shared Shopping and To-do checklists.
- **Calendar** — an optional look ahead, by month or as an agenda.
- **Documents** — scans, PDFs and photos in folders. An optional tool: it is there only if a Workspace admin switched it on (see *Workspace settings*).
- **Contacts** — the people and organisations you deal with, with their numbers to call. An optional tool as well.
- **Maintenance** — work on the house: planned, in progress, completed or cancelled, on a board and in a list. An optional tool as well.

The **Guide interface** puts Workspace selection, your personal tool shortcuts, **Guide**, and **Settings** at the top on computers and phones. Guide opens a compact grid of enabled tools in your saved menu order, plus completed history and More. Press Escape or Close to return to the opener. **Settings → Profile & settings → Appearance → Interface and cards** offers **Top bar (Galactic Guide)** or **Sidebar (Existing interface)** for the Workspace you pick there, if you prefer the earlier sidebar/phone bar; each Workspace chooses its own. Both interfaces keep the same addresses, permissions and saved work. Only enabled tools appear; disabled tools answer as unknown resources. New Workspaces start with tools off, and switching a tool off keeps its data and storage usage.

**Settings** has three areas, each split into named sections so you never scroll past unrelated forms: **Profile & settings** (yours), **Workspace settings** (name, members, plugins, sharing links, storage, backup — what you see depends on your role) and **Server admin** (server admins only). **Sign out** is in the same menu.

These three settings areas use **Memento Mori**. Theme choices made in Appearance take effect
when you return to the Workspace tools. The private Journal also follows your working theme.

## Getting in

1. You receive an **invitation email** (VMN is invite-only). Open the link, choose a display name and a password (at least 15 characters — a sentence of your own works well; common or leaked passwords, simple patterns and your own name or email address are refused).
2. Sign in with your email address and password.
3. Recommended: **Settings** → **Profile & settings** → **Password & security** → **Enable two-factor authentication**, scan the QR code with an authenticator app and **store the recovery codes** somewhere safe.

Forgot your password or lost your phone? Ask your server admin for an account recovery — a link will be emailed to you.

## Roles in a Workspace

| Role | Can |
| --- | --- |
| **Guest** | read Procedures, schedules, Reminders, Lists and the completed history |
| **User** | … and start, schedule, execute, complete and abort Procedures; create, complete and skip Reminders; assign who is responsible; create and change Shopping and To-do lists |
| **Editor** | … and create, edit, import, duplicate, delete and restore Procedures; create Knot links |
| **Admin** | … and manage members, roles and the Workspace name |

## Write a Procedure (Editors)

**Dashboard → Add → Procedure**, or **Procedures → New Procedure**, opens the builder. A Procedure needs no date. On a computer, authoring stays on one screen.

**On phones:** enter the name, press **Next**, build the outline, then **Next** to review and **Save procedure**. The bottom icon bar holds Back, Cancel, Add section, Add step and Next; every button has the same size and an accessible name. Tap a Section to select it: **Adding to** shows where the next Step goes. Add section and Add step open their own screens. Confirm with the check button to apply to the unsaved outline; cancelling a new Step leaves nothing behind. **More options** in a Step holds images, icons and rules. Procedure details are optional on Review. Back keeps applied changes; Cancel asks before leaving unsaved work. Saving returns to the Procedure, where you can Start a Run.

**On computers:**

1. **Name it.**
2. **Type the steps.** There is already a section called *Steps*: type a step title into **Add a step…** and press Enter — the field is ready for the next one. **Paste multiple steps** takes a list (one step per line; bullets and numbers are removed) and shows what will be added before you confirm; a line that is too long, or more steps than fit (200 per Procedure), is named instead of being cut.
3. **Refine only what needs it.** Open a step to edit it — next to the outline on a computer, as its own screen on a phone:
   - **Instructions** (optional) and an optional **icon**.
   - **Instruction image** (optional, one per step): **Take photo** opens the camera on a phone, **Choose photo** picks a file. Before it is saved, the photo opens in **Edit photo**: turn it left or right, **Straighten** it by a few degrees or make it brighter or change its contrast (choose **Straighten**, **Brightness** or **Contrast** with the buttons, then move the slider), drag the frame or its corners to crop it, use **Hide part of the photo** to block out a serial number, an address or a face (drag the box or its corners; the trash button removes it), then **Done** (or **Done** straight away to keep it as it is; **Cancel** adds nothing). The crop button next to a saved photo opens it again — the edited photo is saved as a new one, so executions that already started keep the old one. The photo button next to them (**Choose from this Workspace’s photos**) reuses a photo that is already in the Workspace — nothing is uploaded again, and its last description is filled in. **⋯ Manage Procedures → Photos** shows all photos with a search; tap one to see where it is used. There, the crop button (**Crop or turn this photo everywhere**) and the replace buttons (**Replace this photo everywhere** with a new photo, or **with another photo of this Workspace**) change the photo in every Procedure that uses it at once, after you confirm; captions stay, and executions that already started keep the old photo. **Not used** (next to **All**) shows only the photos no Procedure uses right now; such a photo can be deleted there with the trash button (**Delete this photo**); executions that used it keep showing it. A **caption is required** — say what the photo shows (e.g. *Blue lever left of the water meter*); it is shown with the photo and read out by screen readers. Hiding creates a new photo: executions that already used the old one keep it — to get rid of the old photo, replace it everywhere under **Photos** and then delete it there. Tap a photo to see it full-screen; there, pinch or double-tap (or use the zoom buttons, the mouse wheel, or + and −) to zoom in, and drag to move around. Write the step so it also works without the photo.
   - **Required** (on for new steps) — the step must be done or marked not applicable before the execution can be completed. Off = optional.
   - **Critical** (off for new steps) — must be confirmed deliberately (press and hold, or tap and confirm).
   - **Advanced rules** — whether a reason is *not asked*, *optional* (the default) or *required* when the step is skipped or marked not applicable.
   - **Apply step** puts your changes into the outline. **Cancel** discards only what you had not applied.
4. **Preview** shows how it will look while executing. It starts nothing, sends nothing and writes no history.
5. **Save procedure.** Nothing is stored before that — there is no autosave. The builder always says where you are: *Step has unapplied changes*, *Unsaved changes*, *Saving…* or *Saved*. While a step has unapplied changes, Save waits until you apply or cancel them. Leaving with unsaved changes asks first. After saving, **Start** (*Start now* / *Schedule…*) is right there.

More in the outline: each step has **⋯** with *Edit*, *Duplicate*, *Move up/down*, *Move to another section…* and *Delete*; every one of these — and pasting — can be taken back with **Undo**. On a computer you can also drag steps (onto another step, or onto a section) and drag sections. **Add section** adds one; a section's **⋯** renames or describes it and gives it an optional **icon** (shown on its tile while executing; without one a checklist icon is used), moves it, or removes it — removing a section with steps asks first, and Undo brings it back. **Details** (under the name) holds the description, the Procedure's icon and tags. The icon picker suggests common icons; search by name or everyday words (*plug*, *fan*, *radiator*, *bin*, *fridge*, …; best matches first), pick a **Category**, or **Browse all**.

If someone else saved the same Procedure while you were editing, your save is refused with a message — nothing is overwritten. You can keep your screen as it is, or **Load the latest version**. Edits never touch executions that already started: those keep the steps (and photos) they started with.

Procedures can be exported as a `.vmn.json` file (**Export as JSON** — without photos) or as a `.vmn.zip` archive **with** photos (**Export as archive**), and imported into another Workspace (**⋯ Manage Procedures → Import Procedure**; both kinds of file).

**Photos in detail:** JPEG, PNG and WebP up to 10 MB. VMN stores a copy of at most 1600 pixels as JPEG, turned upright, with all hidden information removed (location, camera, time). iPhone photos (HEIC) are converted by the browser before they are sent (Safari and other iPhone browsers); if a browser cannot do that, VMN says so — then set *Settings → Camera → Formats → Most Compatible* or share the photo as JPEG. Photos count towards the Workspace's storage, together with its documents (5 GB unless an admin chose otherwise); the editor shows how much is used. When it is full, new photos are refused — existing ones stay. Deleted Procedures can be viewed and restored under **⋯ Manage Procedures → Deleted Procedures**.

## Dashboard

Opening a Workspace shows **Dashboard** — a greeting with the date, a ring for how much of today is done (what you finished today out of that plus what is still due or overdue), and a few compact cards with what needs you now. Chosen Clock/Weather instruments lead the Dashboard, followed by Celestial when you choose to show it and the Workspace enables it. An unfinished execution follows in a large card — **Pick up where you left off** — with its progress and one **Continue** button. **All**, **Mine** and **Shared** at the top filter what is shown; choose your cards under **Profile & settings → Dashboard**. A card appears only when its tool is switched on in the Workspace and it has something to show; on a quiet day the Dashboard is just **All clear — Nothing needs attention right now** (plus what is coming up, if anything). Guide shows cards in your saved order in one column. The existing interface retains two columns on wide screens and one on phones.

- **Needs attention** — what is overdue (marked **Overdue**) and what is due today, with a count: a Reminder offers **Done**, a Procedure **Start**. Overdue dates stay until you complete or skip them; nothing is marked done by itself. If a repeating item is overdue several times, it is shown once ("3 overdue") with **⋯ → Skip the older ones…**. At most five are listed; **N more** leads to Reminders (or the Calendar).
- **Continue** — further executions that are not finished (the first one is the large card at the top), with how far they are and **Continue**.
- **Next up** — the next few dates within a week (*tomorrow*, *in 3 days*), with the way to the **Calendar**.
- **To buy** — grocery lists that still have something on them and how many items; tap one to open it.
- **Maintenance** — with the Maintenance tool on: planned work from today up to two weeks ahead, and planned work whose date has passed, with the linked equipment where Equipment is on. Tap one to open it. Read-only here; it never shows costs.
- **Recently completed** — what was finished in the last 3 days, newest first (at most five). A linked Run and its date count once; undoing a completion removes it.
- **Progress** (off unless you switch it on) — done today, this week and active, without zeros; *How this is counted* explains the time zones.
- **Calendar** (off unless you switch it on, with the Calendar tool) — the next few dates as a short agenda.
- **Weather** (off unless you switch it on, and only where your server admin allows weather) — the place you chose, a condition icon with the rain chance (or amount where no chance is given), the current temperature and today's high and low. Open Weather for the dedicated screen: the current reading, a graph of the past 14 days' temperatures, and the next three days. The graph fills in from fresh forecasts after an update; days older than 14 are dropped. Saved forecasts are marked; after 6 hours they disappear.
- **Clock & date** (off unless you switch it on) — an illustrated half of the shared Clock/Weather card, with live clock hands, digital time and date. Open it for the dedicated Clock screen: analogue/digital local time, date and device time zone, Stopwatch with laps, and Timer with presets or 1–1440 custom minutes. Use the same bottom action bar as other focused screens: Back, Start, Pause/Resume, Lap and Reset. Pause before Reset. Stopwatch and Timer keep independent state while you navigate in the signed-in tab; reloading, signing out or closing the app resets them. No sound or background alarm is promised. *Always 24-hour* remains a personal choice.
- Choose your own cards under **Profile & settings → Dashboard** (see *Make it yours*).
- Each item shows the title and one line: when it is due and who is responsible (**Assigned to …** or **Shared**). **⋯** holds the rest: *Details* (Reminder or Procedure, how it repeats, its reminders), *Skip…* (with an optional reason), *Move this date…*, *Assign…*, *Link an execution…*, *Edit schedule…*, *Pause* / *Resume*, *End schedule…*.
- After **Done** a notice offers **Undo**.
- **All / Assigned to me / Shared** appears when Procedures or Reminders is enabled, and filters the cards (remembered in this browser).
- The full completed history is under **Procedures → ⋯ Manage Procedures → Completed history** (on a phone: **More → Completed history**).

**Add** (top right) opens creation for the tool you choose. Choose **List** to start a shared Shopping or To-do checklist. The menu only shows actions your role can use.

## Reminders

**Reminders** lists the standalone Reminders: overdue, today and the next 90 days, each with **Done**; **Recently done** (folded away) shows what was completed or skipped in the last day and by whom, with **Undo**. **New reminder** asks for what and when first; **Notes**, **Repeat**, **Responsible** and **Reminders** (the notifications) are folded behind lines that show their current value — once, shared, and a reminder on the due date unless you change them. Scheduled Procedures are not listed here: they are on the Dashboard when due, on their Procedure, and in the Calendar.

## Shopping and To-do lists

**Lists** holds shared checklists for the Workspace. Choose **New list** or **Add → List**, enter a
name, then choose **Shopping** or **To-do**. Lists you already have are Shopping lists, and the
type is set at creation.

- **Shopping** offers optional quantities and units, with **To buy** and **Purchased** sections.
  Use **Add item** or press Enter to keep adding items. Open **Purchased** to see who checked
  an item off or to put it back on **To buy**. Shopping lists can receive Recipe ingredients
  and appear in the Today **To buy** card.
- **To-do** uses task titles and shows your list’s progress, such as **3 of 7 done**. Check a task
  to move it to **Done**. Open that section and uncheck a task to move it back to **To do**.

- **⋯** on an item: *Edit…* or *Remove*. After ticking, unticking or removing, **Undo** takes it back.
- **⋯** next to the list's name: *Rename list…* or *Delete list* (Undo right afterwards).
- Changes by others appear within about ten seconds. If someone else edited the same item just before you, your edit is refused with a message instead of replacing theirs.
- **Without a connection:** whenever you open VMN with a connection, **all lists of the Workspace** are kept on your device. Without a connection — also after reloading or reopening VMN — the lists open from your device ("Offline — showing the Lists saved on this device at …"). You can tick, untick, add, edit and remove items, and create, rename and delete lists; each change shows **Saved on this device · not sent yet** and is sent once, automatically, when the connection is back. **Undo** takes back a change that has not been sent yet.
- **When others changed the same thing meanwhile:** changes to different items always come together. For the same item (or a list's name) the **later change wins** — by when it was made, using your device's clock for changes made offline; a removed item or a deleted list wins over changes to it. Whenever your change was not applied, a short message says what happened and by whom.
- If your access changed while you were offline (no longer a member, no longer allowed to change lists, or Lists switched off), your waiting changes are **not** applied: they stay on your device with the reason until you choose **Discard these changes**.
- Signing out removes the lists and any unsent changes from the device (VMN asks first if changes are waiting). Browsers can delete stored website data on their own, especially on iPhones after long non-use — open VMN online now and then. VMN asks the browser to keep its data; whether it does is the browser's decision.
- **iPhone:** Safari and VMN added to the Home Screen keep **separate** data. Open the one you take shopping once with a connection before you need it offline.
- **Weak signal:** if the network does not answer within a few seconds, VMN opens from your device and keeps your changes there until the connection is good again.

Use **Find a list** to search by name and **Show lists** to filter by type. Cards show the list
type and progress. To customize a card, open the list and choose **⋯ → List appearance**. Select a
preset icon, or upload a JPEG or PNG as the cover. The icon also appears when a cover cannot load.
The list offers **Download original cover**. Editors can replace or remove the cover, or repair its
preview from **List appearance**. Changes to appearance need a connection. Saved lists still show
their icons offline.

## A new version of VMN

When the server was updated while VMN is open, a note says **A new version of VMN is available.** VMN never reloads by itself. **Reload now** appears when nothing is waiting on your device to be sent; if changes are still waiting, the note says they are sent first, and the button appears as soon as they are. Without a connection, reload once you are online again.
- Guests can read lists; Users, Editors and Admins can change them. A Workspace can have 100 lists with up to 300 items each.

## Bring

A Workspace admin enables **Bring** in Workspace settings → Plugins. Use it for things to take between places: a drill from Home to Van, papers to another flat. It does not track where things are, send notifications or manage inventory.

Choose **Add item**, enter what to bring, then open **Options** for From, To, due date, responsible member and notes. Only the title is required. Existing place text is suggested; places are not separate records. Choose **Save** explicitly; unsaved edits are not kept. Open items are grouped by destination. Filter All / Assigned to me / Shared; select Completed or Cancelled in History to see attribution and reopen an item. Guests read; other members can edit, mark Done, cancel or delete. Assignment grants no extra access. Delete removes an item directly and offers Undo; it has no Trash. The collection holds at most 1,000 records, including history/deleted records.

The Dashboard's optional Bring card shows up to three open items that are overdue, due within seven days, or have no due date and are assigned to you. It follows the same assignment filter. Done has Undo; notes stay in Bring. Switch the card off or move it in Profile → Dashboard; reorder the tool in Profile → Tool menu order. Switching the Workspace tool off hides it and retains its data. Bring needs a connection; failed or stale changes are reported. Workspace backups include Bring history, but restored items start unassigned.

## Documents

*Only in Workspaces where an admin switched Documents on. Documents need a connection; they do not work offline.*

**Documents** keeps scans, PDFs and photos in **folders** — for example *Water*, and inside it *2026*. Nothing is set up for you: you create the folders you want.

- **New folder** creates a folder here; open a folder to create one inside it. Folders can be nested (up to ten levels). Two folders in the same place cannot have the same name.
- **Add document**: choose one or several files — together they become **one document**, and each file is a page (three photos of one bill are one document). Give it a title (proposed from the first file's name), choose the folder, and **Save document**. Type, document date, year, tags and notes are optional, behind *More details*. Nothing is kept until you save; files you chose but did not save are removed automatically.
- **Files are kept exactly as you upload them.** VMN never changes, shrinks or cleans an original. That also means a photo keeps what is hidden inside it — for example **where it was taken (GPS)** or the name of the device — and a PDF may name its author. **Everyone in the Workspace, including guests, can download the originals.** If that matters, remove such details before uploading.
- Accepted: **PDF, JPEG, PNG and iPhone photos (HEIC)**, up to 50 MB each (your server admin may set another limit). Other files are refused with the reason. If one of several files fails, the others are kept; **Retry** sends only that one again.
- **Find a document.** The first page of Documents lists your folders and, under **Recently added**, every document of the Workspace — newest upload first, each with the folder it is in. A folder shows its own documents.
  - **Search** looks in titles, notes and tags — and in the **text of the files** once it has been read (see *Text in your documents* below). Capital letters and accents do not matter ("mull" finds "Müll", "perche" finds "perché"), and a word is also found inside a longer one ("rechnung" finds "Stromrechnung"). Type several words to find documents that contain all of them. Inside a folder the search covers that folder; if nothing matches there, **Search all folders** repeats it everywhere.
  - **Filters** (folded away until you open them): folder — with or without its sub-folders, or *Not in a folder* —, type, year, tag and who uploaded it. They can be combined; each one in use appears as a chip you can remove by itself, and **Clear filters** removes everything at once. Only values that some document actually has are offered.
  - **Sort by** upload date, document date, title or last change, either way. The date shown on each row is named after the order you chose — "Uploaded …", "Document date …" or "Changed …" — so the date on the paper and the day of the upload are never confused. Documents without a document date come last under that order and say "No document date".
  - **List** or **Grid**: the grid shows the first page of each document as a picture, always with its title. Your choice is remembered in this browser.
  - Long lists come fifty at a time: **Show more** adds the next fifty. Documents in Trash are never found.
  - Your search and filters are part of the page's address, so going back from a document returns you to the same list. This also means the words you searched for are in this browser's history.
- **Open a document** to see its details and pages. Each page shows a **preview** — a picture made from the file, never the file itself; select it to enlarge it and read small print. **Download original** gives you the file exactly as it was uploaded; **Download all originals** fetches every page's file.
  - **iPhone photos (HEIC)** are stored and can be downloaded, but show **"Preview unavailable for this format"**: VMN does not yet include the software to display them. Tip: iPhones can save photos as JPEG (*Settings → Camera → Formats → Most Compatible*), which do get a preview.
  - A **password-protected PDF** is kept without a preview. A PDF with many pages gets its previews a little after uploading; at most the first 500 pages are previewed.
  - Switching Documents off pauses unfinished previews and keeps the originals and existing previews. After switching it back on, unfinished previews resume on the next background scan (hourly, or when the server starts).
- **The document date** is the date written on the paper. **Year** is the year it belongs to — a tax notice for 2026 may be dated January 2027. Lists always say which date they show ("Document date …" or "Uploaded …"). Who uploaded a document and when never changes; **Last modified** shows who changed it last.
- **Pages**: the arrow buttons (↑ / ↓) change the order, the bin button takes a file out (it is then deleted), **Add files** adds pages. Every icon button names its action when you point at it or use a screen reader. The order is the same for everyone.
- **⋯** on a document: *Edit details*, *Move* (to another folder), *Move to Trash*. **⋯** in a folder: *Rename*, *Move* (everything inside moves along; a folder cannot go into itself), *Select documents* (to move several at once), *Document types…* (your own types, such as "Condominium minutes"; a type you retire stays on the documents that have it), *Trash*, and *Move folder to Trash*.
- **Trash**: deleting moves a document, or a folder **with everything in it**, to Trash — right afterwards you can **Undo**. In **Trash** you can **Restore** it later, or open a deleted folder (*Show contents*) and restore only a part. Restoring tells you if something changed: when a folder with the same name exists now, the restored one is called "*Name* (restored)"; when the folder it was in is gone, it returns to the nearest folder that still exists, or to the top. **Nothing is removed from Trash automatically**, and what is in Trash still counts towards storage.
- **Links.** A document can be linked to a **procedure**, to a **reminder or scheduled procedure**, and to another **document** (for example a bill and its receipt). On the document, **Linked** lists them with where they stand ("In Trash", "This procedure was deleted", "Ended", the next due date); **Link to…** adds one, the crossed-out link button (*Remove link*) removes only the link. The procedure, and the reminder's *Details*, show **Linked documents**. A link is a reference: nothing is copied, and it gives nobody access to anything they could not open anyway.
  - **Remind me…** on a document: choose *A reminder* (for example "Pay the water bill") or *A scheduled procedure*, then set the date and how you are reminded in the usual dialog. Only the title is proposed from the document; nothing is created before you confirm. Reminder emails and Telegram messages never contain the document.
  - **Documents kept with an execution.** On an execution, **Documents → Link a document…** keeps the document **as it is at that moment** — its details and files — with the execution. If the document is changed, moved to Trash or deleted for good later, the execution still shows the version of then, and says that the document has changed or is gone. While the execution is running, a kept document can be removed again by anyone who manages documents. **Once it is finished, only a Workspace admin can remove it** (**Remove from this execution…**): the admin must give a reason and confirm. The execution then no longer shows the document or its files; a note stays in its place for good — *Document removed*, when, by whom and why — and nothing of the document. The document itself, versions other executions keep, the execution's results and its earlier history are not changed (the earlier history line "linked the document …" keeps the title). Files nothing else uses can no longer be opened and their storage is freed; copies in backups stay until the backups are replaced. Kept versions count towards storage.
- **Deleting for good** (Workspace admins only): in Trash, **Delete permanently…** on one entry, choose several and **Delete chosen permanently…**, or **Empty Trash…**. VMN first tells you how many documents, folders and files this removes. **It cannot be undone** — nobody can restore them afterwards. A folder takes along what went to Trash with it; something you had deleted separately before stays in Trash. The history keeps who deleted what and when (with titles, not the files). A version that an execution keeps is **not** removed with the document; links from other records then say "deleted for good", without the title. The storage is freed within about an hour — for files uploaded less than a day ago, a day after their upload. **Backups are a separate matter:** copies may remain in the server's backups until those are replaced; ask whoever runs the server if something must be gone everywhere.
- **Export**: **⋯ → Export this folder…** (with its sub-folders), **Export all documents…** on the first page, or *Select documents* → **Export selected…**. You see how much it is, then download **one ZIP file**: the original files, exactly as uploaded, in their folders (one folder per document, pages numbered), a page that lists everything and opens in any browser without VMN (`index.html`), and the same details for programs (`metadata.json`). Trash is not included. Everyone who can see documents can export them, guests too. One export holds up to 2 GB and 5 000 files — export folder by folder if you have more. Exports are recorded in the Workspace's history. Remember that the originals may contain location or other hidden details, and that a downloaded export is no longer protected by VMN.
- **Guests** can open, preview and download documents; **Users, Editors and Admins** can add, change, move and delete them. There are no separate permissions per folder.
- **Storage**: a Workspace has one storage limit for everything in it — documents, their previews and recognised text, instruction photos of Procedures, and Trash (5 GB by default). When it is full, new files are refused and the message says how full it is; everything already there stays readable. Admins see what uses the storage under *Workspace settings → General*.
- **Text in your documents** (where an admin has not switched it off): after you upload a file, VMN reads its text **in the background, on your own server** — the text a PDF contains, or, for scans and photos, by recognising the printed letters (English, German, Italian and French). Nothing is sent to an outside service. Afterwards a search also finds words printed on the paper: "bolletta" finds a photographed water bill. Search results then show the words around the match and on which page they are ("Page 2: …"). Under each file, the document page says whether its text was read, is still being read, **could not be read** (with **Retry** for those who may change the document — the file itself is fine and stays usable) or cannot be read at all (password-protected PDFs and iPhone HEIC photos). Reading takes a few seconds per scanned page; at most 50 scanned pages and 500 pages in all are read per file. The text is only ever used for search: it changes nothing in the document, and it is visible to exactly the people who can see the document — guests included. It counts towards storage and is removed when the document is deleted for good. Recognition is not perfect: small, blurred or handwritten text may be missed. **Workspace admins** switch it off or on for the whole Workspace under *Workspace settings → General → Text recognition*, which also shows how many files were read, are waiting or could not be read. Off: nothing new is read, and text already read stays searchable. On again: the files that waited are read too.
- **See and correct the text:** under each file, **Recognised text** opens what was read — page by page, with where it came from ("From the PDF." or "Read from the image (OCR) — may contain mistakes.") — and **Copy text**. Everyone who can see the document can open it, guests included. Those who may change the document can **Edit text**: fix what was misread, or type in what could not be read at all (a handwritten note, an iPhone HEIC photo). Your text is kept apart from what was read: search and suggestions use it, the file shows "Corrected by … on …", and reading the file again (**Retry**) never replaces it. **Restore recognised text** throws your version away and uses what was read again. If someone else saved the text while you were editing, your save is refused and VMN says so — nothing is overwritten; your typing stays in the box, and **Cancel** shows their version. Your text counts towards storage; the history records who corrected or restored the text and when, never the text itself. A corrected file has one text, so a search hit in it shows the file but no page number.
- **Suggestions from the text** (for those who may change the document): when the text of a document clearly says what it is, the document page shows **Suggestions from the text** — for example *Type: Bill*, *Title: Bolletta ACQUEDOTTO PUGLIESE S.p.A.*, *Document date*, *Amount: 87.40 EUR*, *From: …* (the company), and *Payment due: 15 Aug 2026*. Each one says where it was read ("From the text on page 1: “Scadenza pagamento: 15/08/2026”"). **Nothing changes until you choose:** **Use** sets that one detail (amount and company have no field of their own: **Add to notes** adds a line to the notes); **Dismiss** removes the suggestion for good on this document, also if the text is read again. For a payment due date, **Remind me…** opens the usual reminder dialog with that date — you check the date and how you are reminded before anything is created. What you set yourself is never replaced by a suggestion, and a detail the document already has is not suggested. Suggestions come from simple rules for Italian, German, English and French bills, receipts and contracts; they can be wrong, so always compare with the paper.
- **Not checked for viruses.** VMN stores only the four file types above and never runs a file, but a downloaded file is opened by your own programs — treat files from others with the usual care.

## Contacts

*Only in Workspaces where an admin switched Contacts on. Contacts need a connection; they do not work offline.*

**Contacts** keeps the people and organisations you deal with — the plumber, the electrician, the utility provider, an office. A contact is **not an account**: it cannot sign in and gets no access to anything.

- **Add one:** type a name and **Save** — that is all that is needed. **More details…** opens the full form: role or category (for example *Plumber*), organisation, any number of phone numbers and email addresses (each with a note what it is for, such as *Mobile* or *Office*), postal address, website and notes. You can add these later with **Edit**.
- **Call or write:** a phone number is a link — tap it on a phone and the dialler opens. An email address opens your mail program. A website opens in a new tab; only addresses that start with http or https are accepted.
- **Find a contact:** search looks in names, organisations, categories, phone numbers and email addresses (not in notes or postal addresses). Capital letters and accents do not matter, and a number is also found without its spaces. **Category** shows only one category. Long lists come fifty at a time.
- **Possibly the same as …:** when a contact has the same email address, the same phone number or the same name as another one, VMN says so — while you type, after saving, and on the contact. **Nothing is merged and nothing is refused:** both stay, and you decide. (A number written once with and once without the country code is recognised as the same when the last eight digits agree.)
- **Linked:** a contact can be linked to a **procedure** ("whom to call" — the procedure then shows *Contacts* with the number) and, where Documents is switched on, to **documents** (a bill and the provider it came from). A link is a reference: removing it removes neither side.
- **Import** (**⋯ → Import from a file…**): choose a **CSV** file or a **vCard** file (.vcf) — for example an export from your phone or mail program; at most 1 MB and 1000 contacts. **You see everything before anything is saved:** every contact found, those that **may already exist** (listed first and not ticked — tick one to import it anyway), those that **cannot be imported** with the reason, and what was not used from the file. Only what is ticked is saved when you choose **Import**. Photos inside a vCard file are not imported.
- **Add one contact to your phone:** open that Contact and tap **Add to device contacts**. This downloads only that Contact as a `.vcf` file; open it and confirm the import in your phone’s address book. If iPhone’s downloaded-file viewer does not offer to add it, open the `.vcf` as an attachment in Mail or Messages. Android can import it through **Contacts → Organise → Import from file**. USER and above can do this; guests cannot export Contacts. This is a copy, and later VMN edits do not sync.
- **Export** (**⋯ → Export as CSV / Export for iPhone / Android…**): all contacts as one file. Users, Editors and Admins can export; guests cannot. The file is a copy outside VMN — keep it as carefully as the contacts themselves. In the CSV file, a value that a spreadsheet would treat as a formula starts with an apostrophe.
- **Delete:** **⋯ → Delete…** moves a contact to Trash; right afterwards you can **Undo**, and later **Restore** it under **⋯ → Trash**. While it is in Trash, what it was linked to shows "a deleted contact". **Deleting for good** is for Workspace admins, in Trash: it cannot be undone, and nothing of the person stays — the history keeps that a contact was deleted, not who it was. Copies in backups of the server stay until those backups are replaced.
- **Who can do what:** everyone in the Workspace, including **guests**, can see all contacts. **Users, Editors and Admins** can add, change, link, import, export and delete them. There are no private contacts.
- Contacts are other people's personal data. Keep only what you need, and remember that every member of the Workspace can read it.

**Import VMN contacts on your phone:** expand **Export for iPhone / Android…** and choose **Download contacts (.vcf)**. This downloads every active Contact in this Workspace as one UTF-8 vCard file; guests cannot export. It is a copy, with no automatic synchronisation.

- **iPhone:** open the `.vcf` as an attachment in Mail or Messages, then add the contacts. See [Apple’s contact import instructions](https://support.apple.com/en-mide/guide/iphone/iph356499f31/26/ios/26).
- **Android (Google Contacts):** choose **Organise → Import from file**, select the `.vcf`, then select the account. See [Google’s import instructions](https://support.google.com/contacts/answer/15147365?co=GENIE.Platform%3DAndroid&hl=en). Menus in other Contacts apps can differ.

## Maintenance

*Only in Workspaces where an admin switched Maintenance on. It needs a connection; it does not work offline.*

**Maintenance** keeps track of work on the house — a boiler service, a repair, an inspection: what is **planned**, what is **in progress**, what is **completed** and what was **cancelled**.

- **Add a record:** type what needs doing and choose **Add** (it starts as *Planned*; a record is completed only when someone says so). **More details…** opens the full form: category (for example *Heating*), the date it is planned for, a responsible contact (if Contacts is switched on), what it cost, and a description. Only the first field is required.
- **The board** shows one column per status. To change a status, **drag the card** to another column — or use the **status menu on the card**, which also works with the keyboard and on a phone. On a phone the board shows one status at a time; the buttons above it switch between them and show how many records each has.
- **The list** shows every record, newest first. You can search and filter by status, category, responsible contact, Equipment (where enabled) and year. Completed records are filed under the day they were completed.
- **A record is completed only when someone says so.** Linking an execution, or finishing that execution, does not complete it — and completing a record changes nothing else. When you set *Completed*, the record gets today's date as its completion date; setting it back removes that date.
- **Cancelled is not completed:** a cancelled record never shows a completion date.
- **If someone else changed the record meanwhile**, your change is not applied; you are told, and you see the current state.
- **Cost** is written down as it is — for example *120.00 EUR*. VMN never adds costs up, converts currencies or shows totals.
- **Linked:** on a record you can **Add or link evidence…** (a document: the invoice, a photo, the report), **Link to a procedure…**, **Link an execution…**, and **Remind me…**. Links are references: nothing is copied, and removing a link removes neither side. **Remind me…** creates an ordinary reminder (or schedules a procedure) with its own date and notifications — the record's own date reminds nobody.
- **Delete:** **⋯ → Delete…** moves a record to Trash; right afterwards you can **Undo**, and later **Restore** it under **⋯ → Trash**. Workspace admins can delete for good from Trash; that cannot be undone.
- **Who can do what:** everyone in the Workspace, including **guests**, sees all records and their costs. **Users, Editors and Admins** add, change, link and delete them.

## Equipment

*Only where a Workspace admin enabled Equipment. It requires a connection.*

The reference collection puts **brand and model** up front. Search finds names, brands, models and **replacement parts & compatibility**. **Copy model** and **Copy replacement details** copy the chosen text after you press them; if clipboard access is unavailable, select the visible text to copy manually.

The initial form asks for name, brand/manufacturer, model and replacement/compatibility notes; only the name is required. **Add field** reveals optional location, category, serial number, purchase/warranty dates and notes, or adds a custom labelled detail (up to 16, labels 60 characters, values 500). Existing details remain visible when editing. These details are shared with every Workspace member, including guests. Serial numbers, notes and arbitrary custom detail values are not searched; put compatible filters/covers in the dedicated replacement field to find them. Save explicitly; there is no autosave.

Choose **Add equipment** and enter a name — for example *Boiler*. Later, **Edit equipment** can add a category, location, manufacturer, model, serial number, purchase date, warranty expiry and notes. Categories, locations and manufacturers offer values already used in this Workspace. Search and filters find live records; **Show more** continues the list.

On the detail page, **Link to…** links existing manuals, receipts, warranties and photos in Documents, service Contacts, MaintenanceRecords and Procedures. Nothing is copied and a Link grants no access. Maintenance history shows its dates and statuses, newest first; completing maintenance remains a separate manual action. A deleted Contact is unnamed. Switched-off tools contribute no links or controls. On a MaintenanceRecord, **Link equipment…** adds the same reference; the Maintenance list also has an Equipment filter.

**Warranty reminder…** proposes a normal Reminder with the warranty expiry date and a one-calendar-month notification offset. Review the title, date, repetition and notifications before **Create reminder**. **Remind me…** also handles ordinary servicing reminders or scheduled Procedures. Generated reminder titles use only the Equipment name, never its serial number. Reminders appear in the ordinary Reminders and Calendar views when those tools are enabled.

Changing a warranty date changes no Reminder. If a Reminder is linked, VMN offers **Review reminder…**; only saving that separate dialog updates the Reminder. Disabling Equipment keeps its data and leaves ordinary Reminders running according to their own tool settings.

**⋯ → Move to Trash** preserves the record and links; **Undo** restores it immediately, and **⋯ → Equipment Trash** on the list offers Restore later. Workspace admins can permanently delete from Trash with confirmation. Linked Documents, Contacts, MaintenanceRecords and Reminders survive; backups keep older copies until they rotate. Guests read all Equipment metadata, including serial numbers. Users, Editors and Admins manage records; only Admins delete permanently. Concurrent edits are refused instead of overwriting someone else’s work.

## Calendar

**Calendar** is the optional planning view: one month at a time, with everything that has a date — also what is upcoming and what was done:

- **Month** (calendar icon) shows the days with what is on them, with week numbers; today has a filled circle. Choose a day to see its entries beside the month (below it on smaller screens), with the same actions as on the Dashboard (**Done**, **Start**, **Start early**, **Continue**, **⋯**, **Undo**). On a phone the days show dots instead of titles. **Agenda** (list icon) lists the same month day by day and is what a phone shows first. Your choice is remembered in this browser.
- Under the month name, a short line counts what is open, overdue and done this month.
- Every entry carries a sign and a word: ○ open, ! overdue, ▶ in progress, ✓ completed, ↷ skipped (with who did it and when), and ◌ **Planned**.
- **Planned** entries are the future dates of something that repeats on fixed dates — also years ahead. They show what is coming; they can be completed once their turn has come and they appear on the Dashboard and under Reminders. Things that repeat *after they are done* have no planned dates, because the next date depends on when you finish.
- **‹ ›** change the month, **Today** returns. With the keyboard: the arrow keys move between days, Page Up / Page Down between months.
- **Filters** (funnel icon): open / overdue / completed / skipped, who is responsible, and Reminders or Procedures. They combine, and they are remembered in this browser; a dot on the icon and a note under the month tell you when something is hidden.

The calendar only shows and lets you act; there is no dragging of entries.

### Subscribe in Apple Calendar or Google Calendar

The **subscribe** button (calendar with an arrow, next to Filters) makes a private link to this Workspace's calendar that calendar apps can follow:

1. Choose **Mine** (what you are responsible for, plus shared entries) or **Everyone** (the whole calendar as you see it).
2. **Create private link**, then **Apple Calendar** (opens the Calendar app on an iPhone, iPad or Mac) or **Google Calendar** (opens Google Calendar's "add by URL" page). Other calendar apps: copy the link and add it as a subscription ("From URL").

What you get: the titles, dates and times, whether it is a Reminder or a Procedure, who is responsible, and a ✓ in front of what is done — from a month back to about six months ahead. No notes, Steps, email addresses or anything else. It is read-only: changes are made in VergissMeinNicht and reach the calendar app the next time it refreshes. Apple and Google decide how often that is — usually every few hours, sometimes less often for Google.

Keep the link to yourself: anyone who has it can see what it shows, without signing in. For safety the link is shown only once. **New link** (circular arrows) replaces it — the old one stops working at once, so add the new one to your devices. **Turn off subscription** stops it for good. The link also stops when you leave the Workspace, when the Calendar is switched off for the Workspace (it works again when it is switched back on), or when your account is disabled or recovered. Google Calendar fetches the link from Google's servers, so it only works when your VergissMeinNicht is reachable from the internet; Apple Calendar on an iPhone or iPad fetches it from the device itself, so there it can also work inside your home network or VPN.

## Reminders and repeating schedules

A **Reminder** is something to remember without steps (a title and optional notes); a **scheduled Procedure** is a Procedure with a date. Both can repeat:

- **Once** — one date.
- **On fixed dates** — every N days, weeks (optionally on chosen weekdays), months (optionally on the last day) or years. Dates stay fixed even when one is done late; a day that does not exist in a month (the 31st, 29 February) moves to that month's last day and the next one returns to it.
- **After it is done** — every N days/weeks/months/years counted from the day it was completed (or skipped).

Every date is its own entry: completing last year's never completes this year's. **Responsible** (optional) names who is expected to do it and who gets the reminders; it grants no extra rights, and anyone allowed to execute may complete it (VMN records who actually did). **Pause** stops new dates and reminders; **Resume** offers to skip the dates that fell into the pause. **End** keeps the history.

Reminders can come *on the due date*, *N days/weeks/months before* (at your default reminder time) or *N hours before* a timed date — up to 5. They go to the responsible person, otherwise to whoever created the schedule. If VMN was unavailable when a reminder was due and it is more than a day late, you get **one short summary** of what was missed ("Missed reminders: …") describing each item's current date and status — never a flood of old messages. The Dashboard and enabled Reminders/Calendar provide the reliable overview, whether a message arrived or not. Disabling Procedures or Reminders stops notifications for its own scheduled items and hides them; records and recurrence dates stay intact. Calendar disable only hides the view. Reenable catches up notifications from the last 24 hours and drops older notifications, without completing any item or flooding your channels.

## Start or schedule a Procedure

On **Procedures**, every Procedure has **Start** right in the list (no need to open it first):

- **Start now** — begins at once. If the Procedure is already being done, VMN says so (*"… started by Jane 18 minutes ago"*) and offers **Continue existing** or **Start another anyway**.
- **Schedule…** — choose once or a repetition, a date, optionally a time, who is responsible, and when to be reminded (see *Reminders and repeating schedules*). Nothing starts by itself: on the day it appears under **Dashboard**, and you press **Start**. If the Procedure is deleted in the meantime, its dates say so and can no longer be started.
- **⋯** holds the rest: Edit, *Pin to the top* (only for you — a ★ marks it), Duplicate, Export, Share as Knot link, History, Delete. **Recently used** above the list links to the Procedures you started lately.

Reminders go to the responsible person, otherwise to the person who scheduled it, through the channels switched on under **Profile & settings → Notifications**. They contain the title, the date and the Workspace name, and a link that still asks you to sign in.

## Go through a Procedure

1. **Start** it (or **Continue** on the Dashboard).
2. VMN guides you: first the **Sections** as tiles, each with its icon and a ring that fills as you go (a check when it is finished; the next one to do is marked **Next**, and the large button opens it). In a Section the Steps come **one at a time**: a large card with the Step, a large **Done** button and, smaller, **Skip** and **Not applicable**. After the server confirms a Step, its saved status appears and the next open Step follows by itself. Where Gamification is enabled, earned points can trigger the shared character or confetti celebration; there is no separate Run cheer or vibration. The dots at the bottom show every Step of the Section — tap one, or use **‹ ›**, to go back and forth (for example to **Undo**). When a Section is finished, **Next: …** leads to the next one; when everything is done, **Complete** waits on the finish screen. A Run with one Section opens straight into it. The phone's Back returns from a Section to the Sections. If you ask your device for less motion, nothing moves.
   Prefer to see everything at once? The list button (☰) shows all Steps as a list — the next Step marked **Next**, a bar at the bottom with progress and **Go to next Step**, and *Hide resolved Steps*; the grid button brings the guided view back. Your choice is remembered on this device. On a phone the bottom navigation steps aside while you execute; **← Dashboard** leads back.
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

**Settings → Profile & settings**, one section at a time. The sections have icons and are grouped: *You* (Profile, Password & security), *Look & feel* (Appearance, Dashboard, Confirmations), *Stay informed* (Notifications, Weather) and *Journal*. On a phone they are a grid of icon tiles.

- **Profile** — **Tool menu order** lets you move enabled tools up or down and press **Save menu order**. Dashboard stays first and More stays last on phones. The first two enabled tools in your order appear beside Dashboard; More keeps every enabled tool reachable. The sidebar and Places menu follow the same order across your Workspaces and devices. This changes only your order, never tool availability or access. **Use default order**, then Save, restores the original menu. Your picture, name and email, and the Workspaces you belong to (with your role; ★ marks the one that opens first, ⚙ leads to its settings). Tap the **camera** on the picture to add or change it, the **bin** to remove it. The picture is cut to a square; your device and the server both re-create it, so no location, camera details or other hidden data from the original file are kept. It shows in the Settings button, here, and in **Members** of your Workspaces to members who can see the member list (not to guests, never to other Workspaces). Without a picture your initials are shown.
- **Notifications** — your default reminder time (09:00 unless you change it), email reminders on/off, and Telegram. Once your server admin has set up a Telegram bot, connect **your own** chat: **Connect Telegram** → open the link in Telegram and press *Start* → come back (the page notices it by itself) → **Confirm** the chat (only if it is yours — otherwise *Not me*) → connected, shown with your Telegram name. You never type a chat ID. *Disconnect Telegram* stops it at any time.
- **Dashboard** — your own Dashboard: switch each card on or off, move it up or down, make it **Wide** (spans both columns on a large screen; phones always show one column), choose how many lists **To buy** shows (1–10), whether **Clock & date** is always 24-hour and how far back **Recently completed** looks (*Today*, *the last 24 hours*, *3 days* — the default —, *7 days* or *Off*), and **Compact** or **Comfortable** spacing. Every change is saved to your account at once (the page says *Saved.*) and applies in every Workspace; **Reset to default** brings back the standard layout. A card of a tool your Workspace does not use is marked *Not used in this Workspace* and never appears — choosing cards here never hides or shows a tool for anyone else. Your layout is kept on this device for offline use and deleted when you sign out.
- **Weather** — your own weather, independent of where you are: **search for a place** (the search is sent to Open-Meteo from the server) or **enter coordinates**, optionally an **elevation** (helps in hills and mountains), the **provider** (*Automatic* = Open-Meteo, then MET Norway; or one of them), and for Open-Meteo the **model** — only models that cover your place are offered, each with how many days it forecasts and what it lacks (e.g. *ItaliaMeteo ARPAE ICON-2I · 3 days · no rain probability*). Changing the place resets the model to Automatic; nothing else changes. With a chosen provider you can allow **another one if yours is unavailable** — it is then named on the card. °C or °F, tomorrow on or off. **Save weather settings** saves; the detailed forecast is below — as many days as your provider and model offer (Open-Meteo up to 16, ICON-2I 3, MET Norway about 10; the first week shown, *Show all* for the rest), with its source, update time and attribution. *Optional providers with your own credentials*: if you have an OpenWeather or Meteomatics account you can enter its API key or username and password, a daily call budget (VMN stops there — never above the provider's free allowance) and **Save and test**; afterwards only the status is shown (*set*, calls used today, last test), with **Test connection** and **Remove credentials**. Nobody else can see or use your credentials. If your server admin shares credentials for a provider, you can use it without your own; your own always come first. These providers are entirely optional — weather works without any account. **Compare forecasts** (below the forecast): tick the sources you want side by side — Open-Meteo models that cover your place, MET Norway, and paid providers you have credentials for — and press **Compare**. Free sources are fetched as usual; paid ones are only shown if they are still cached, otherwise VMN tells you how many paid requests fetching them would use and waits for **Fetch paid forecasts now**. Pick a day; each source shows what it forecasts for that day — or that it has no forecast for it, or that it gives no value (*not given*, which is not the same as 0 mm). The line at the top shows the range across sources; no forecast is marked as right. Comparing never changes the provider used on the Dashboard. Only you see these settings; your phone or browser never contacts a weather service — the server does, with your place rounded to about 1 km. Your browser's location is never used.
- **Appearance** — with no Workspaces yet, one theme for your whole account: **System** (follows your device, also when it changes), **Don't go into the (light)** (ivory, ink and deep teal), **Memento Mori (dark)** (warm black, bone, burgundy, brass and an hourglass detail), **Tokyo Nights** (a neon city at night in the style of old arcades: Mount Fuji, Tokyo Tower and a moving grid behind the page, glowing buttons, the Dashboard clock as a flip clock, Run Sections as square "level" tiles) or **Witch Forest** (an old forest at night, serious rather than spooky: ancient trees, botanical ivy, mist, faint fireflies and old-book type; the Dashboard clock beside a tilted stone sundial with a carved rune, a small crimson drop, a fixed iron fin and a time-indicating shadow, progress as a moon that fills, Run Sections as a path of stepping stones and each Step as an old book page). The former Dark choice now opens Memento Mori; saved account and Workspace choices keep working. Each theme is shown as a small picture. All themes work the same: same buttons, same order. Tokyo Nights and Witch Forest move gently; if your device is set to reduce motion, everything stands still. Saved to your account, so it follows you to every device. Once you have a Workspace, this list is replaced by the **Interface and cards** section below, where you pick a Workspace; the account theme stays as the fallback for a Workspace without its own.
  - **Each Workspace** — once you have Workspaces, pick one as a tab under Profile & settings → Appearance. Its tab holds three parts: **Theme** (the Workspace's own theme; the account theme is the fallback for a Workspace without one; the **star** makes the Workspace the one that opens first, and tapping it again returns to "last used"), **Interface and cards** (the **Layout** (**Top bar (Galactic Guide)** or **Sidebar (Existing interface)**), its card background style, card background opacity (0–100%) and decorative images for Galactic Guide, then press **Save**; **Cancel** restores saved values and **Reset** previews defaults until Save) and **Weather** (whether your weather in that Workspace uses the Workspace's shared location; your own place and forecast settings are under Profile & settings → Weather). Pick a theme for a Workspace to tell them apart at a glance, e.g. Tokyo Nights at home and Witch Forest in the camper van. Choosing a theme for a Workspace replaces its earlier choice; the Theme part cannot return a Workspace to the account theme. The choices are yours alone and apply to that Workspace only; other Workspaces and other members keep their own. Only you see your choice; it never changes what others see.
  Appearance uses compact theme pictures and names. The star chooses your default Workspace; Save (disk), Cancel (cross) and Reset (circular arrow) are icon buttons with accessible names/tooltips. On phones, top-bar/sidebar, illustrations and Workspace-location controls also use icons. Extra explanations open from the info icons. The opacity slider keeps its percentage visible. Layout/card edits still need explicit Save; Cancel restores the saved choices and Reset only previews defaults until Save.
  **Places** offers **Munich** (an illustrated Alpine panorama), **Triora** (a small village among wooded mountain ridges), **London** (an old riverside pub garden) and **Scotland** (northern coast and standing stones), light or dark as your device is set. In the existing interface, Open horizon uses a labelled floating dock and **More** opens enabled tools. Guide uses its top navigation across every theme. Existing addresses and tool permissions remain the same. Pick one like any theme, for one Workspace or, with no Workspaces, for the account.
- **Places** — appears only while the Workspace you are in uses a Places theme. Choose the background: the place’s illustration (default), **your own photo**, or **no image** (just the colours). Drag the point in the preview (or use the arrow keys) to choose what stays visible on a computer and, separately, on a phone; set how strongly the page colour covers the picture, a blur (0 keeps it sharp) and darker edges. The preview shows both screen sizes; nothing changes until you press **Save**, and **Cancel** goes back. **Restore Places defaults** resets only your own look in this Workspace. Your photo is private: only you see it, the server removes location and camera data, and it does not use the Workspace's storage. The picture is strongest on the Dashboard and fades back on working pages so lists stay readable. **Effects** belongs in these theme settings alongside the background controls. **Dashboard card opacity** sets ordinary Dashboard card backgrounds from transparent (0%) to solid (100%); the preview updates immediately, and **Save** keeps the choice for you in this Workspace. Text and controls stay opaque. Clock/Weather and Celestial use the same theme-aware card surface and this same personal opacity setting; their text and artwork stay opaque. The Dashboard uses the same centered content area as other pages. Light follows the time of day, with gentle mist and occasional fireflies, a bee or a drifting leaf. Decorations run only on the default illustration and stop with reduced motion or when hidden; no forecast provider or device geolocation is requested.
  Witch Forest's subtle moonlight is calculated on your device. It uses the current Workspace location if you opted in under Appearance for that Workspace, otherwise your personal Weather location; without coordinates it follows the moon phase. It never asks for your device's location. Saved location changes refresh the atmosphere immediately; switching Workspaces selects the matching place. The astronomy calculation needs no weather-provider connection.
- **Password & security** — change your password; two-factor authentication.
- **Confirmations** — how critical Steps are confirmed: press and hold, or tap then confirm.

## Workspace settings

**Settings → Workspace settings**:

Grouped with icons like Profile & settings: *Workspace* (General, Members), *Tools* (Plugins, Sharing links) and *Data* (Storage, Backup). The heading shows the Workspace and your role.

- **General** — the Workspace's name (Admins can change it), its shared location, your role, and **Leave Workspace**.
- **Storage** (Admins) — how much the Workspace stores — instruction photos, documents, previews, Trash — and of how much; you can set a lower limit of your own, never a higher one than the server admin allows; lowering it deletes nothing, it only refuses new files until less is stored. With Documents on, also **Text recognition**.
- **Plugins** (Admins only) — one tile per tool with its icon and an on/off switch: **Procedures**, **Reminders**, **Lists**, **Calendar**, **Documents**, **Contacts**, **Maintenance**, **Equipment**, **Journal** and **Celestial**. A tool switched on appears for everyone in the Workspace; switching it off hides it for everyone and keeps everything in it (there is no personal hiding). The ⓘ button shows what a tool does.
- **Backup** (Admins) — **Create backup** makes one file with everything in this Workspace: Procedures and their history, Reminders and schedules, lists, documents with their original files, contacts, maintenance, equipment, links, Trash, the tool settings, and the members' names, roles and email addresses. It is made in the background (the page shows the progress) and kept for 24 hours for you to **Download**, or **Delete now**. Not included: passwords, sign-in data, sharing links, personal and notification settings, credentials, other Workspaces. The file is **not encrypted** — keep it as safe as the data itself. A server admin can restore it as a new Workspace.
- **Members** — who is in the Workspace, with their picture and role; Admins also see email addresses, change roles, remove members (bin icon) and add members.
- **Sharing links** (Editors and Admins) — every Knot link, with **Revoke**.

## For server admins

**Settings → Server admin** (only shown to server admins), one section at a time:

- **Workspaces** — create a Workspace (you become its admin and add members under *Workspace settings → Members*). **Restore from backup**: choose a `.vmnbackup` file (made under *Workspace settings → Backup*, here or on another server) → **Upload and check**. The upload shows its progress; then the whole file is checked. You see what it contains — the Workspace's name, when the backup was made and by which version, how many Procedures, executions, schedules, documents, contacts … — what to note (people kept as names only, schedules paused, assignments cleared, personal settings not included) and the **previous members** with name, role and email address. **Restore as a new Workspace…** asks once more, then creates a **new** Workspace with you as its only member; when it is done, **Open** it. Nothing existing is changed or overwritten, nobody is invited and nothing is sent — invite the people you want yourself and resume the schedules you need. **Discard this restore** deletes the uploaded file; a checked file you do not confirm is deleted after 24 hours. Backup files are **not encrypted and not signed**: restore only files you trust.
- **Invitations** — invite people by email, send again, revoke.
- **Accounts & recovery** — disable an account (signs the person out everywhere at once) or enable it again; email a recovery link for a forgotten password or a lost authenticator. **Historical identities** lists the people of restored Workspaces with the restore they came from, marked *History only*: they are names in the history, not accounts — they cannot sign in, be invited, recovered or added, and nothing here changes them.
- **Notification providers** — email reminders on/off and a test email to yourself; **Telegram**: paste the **Bot token** from @BotFather (checked with Telegram, stored encrypted, never shown again) and enable it — this sets up the bot for the whole server, not a destination chat. Then, like everyone else, connect your own chat under *Profile & settings → Notifications* (**Go to my notification settings**); only after that can **Send test message to my Telegram** reach you. You can also remove the token. See [Deployment](../admin/deployment.md#reminders-and-notification-providers).
- **Server & storage** — hide the page footer; how many **Recently used** Procedures the Procedures page shows (0–20, 0 hides them); **Workspace storage**: what each Workspace stores (instruction photos, documents, previews, Trash) and the most it may store — 5 GB by default, 100 MB to 1000 GB. A limit is a usage limit: no disk space is set aside, so keep an eye on the disk. Lowering a limit never deletes anything; new files are refused until usage is below it. **Document files**: the largest file a document may hold (1–100 MB, 50 MB by default) and the accepted formats — both apply to new uploads only. **Restoring Workspaces**: the largest backup file a restore accepts (20 GB by default, 0.1–1000 GB; a restore needs about three times that space for a while).
- **Security log** — sign-ins, two-factor, recovery, invitations, account and membership changes.

## Planned changes

All implemented functional tools are selectable now. Mail remains planned and has no control. New text may use English where a translation is not yet available.


### A shared location for a Workspace

A Workspace admin can set an optional place under **Workspace settings → General → Location**. Search for a place or enter its name, latitude, longitude, time zone and optional elevation manually. Save to share it with every member, including guests. The location is included in Workspace backups. Clear **Set a shared location** and Save to remove it. A stale save is refused if another admin changed the place; reload before trying again.

Under **Profile & settings → Appearance**, choose the Workspace, then tick **Use the current Workspace’s location when available**. The tick is set for each Workspace separately, saves at once, starts off, and is disabled when that Workspace has no shared location. Other members keep their own choice. When ticked, the Dashboard's weather and Witch Forest moonlight use that Workspace's shared place; without one they use your personal location. Your provider, units and credentials remain yours; the model becomes Automatic for a shared place. Your personal Weather settings and its detailed forecast/comparison continue to show your personal fallback place.

A Workspace can represent Home, another home, a Van or a Car, but its location is entered manually: VMN never tracks a vehicle or device. Coordinates are rounded to about 1 km. This setting does not change Schedule time zones or the clock's existing local-time display. Weather's server switch and provider restrictions continue to apply; the forest keeps its phase-only fallback when location settings are unavailable.


### Celestial card

A Workspace admin can enable **Celestial** under **Workspace settings → Plugins**. It then appears on the Dashboard; each person can hide or reorder it in **Profile & settings → Dashboard**. It shows equal Sun and Moon illustrations, the calculated lunar phase and illuminated percentage, and the next full moon. A saved shared Workspace location adds today’s local sunrise, sunset, moonrise and moonset; the card shows the configured time zone. Each event belongs to that location’s current civil date, so moonset can appear earlier than moonrise. Days without an event say so. On narrow screens the bodies remain side by side and two columns of readings sit below them. No location is required for phase information; the card does not use device geolocation, Weather providers or personal Weather settings.

### Workspace Notes and personal Journal

**Add (+) → Note — Workspace** creates shared content in the active Workspace. An admin enables
**Notes** in Workspace Tools; every member, including guests, reads it, and users/editors/admins write.
Turning the tool off hides it and keeps its data. Existing shared Journal entries and addresses still
work; their tool setting and saved menu position are preserved.

**Add (+) → Journal entry — Personal**, or **Settings → Private journal**, opens your personal account
Journal. It works without selecting a Workspace. Other users, Workspace admins and server admins have
no private-entry override in the app. On first access, acknowledge the privacy notice before writing:
your entries are unencrypted, and the server operator can access the underlying data. Acknowledgement
is saved per account and notice version. Private entries, drafts and images never enter Workspace
backups or Workspace searches; full server backups include private account data.

**Library and reading (2026-11-12).** Notes open as a library of cards or a compact list: search as
you type, sort (recently edited, entry date, title), notebook and tag chips with counts, an archive
toggle, and **Pinned** first. Each card shows the first image, an excerpt, checklist progress
("1 of 3 done"), the date and tags. Notebooks keep one colour everywhere. The personal Journal adds a
**timeline** view by month: a small calendar with dots on written days, "pages this month", a writing
streak, **On this day** from earlier years and **Today's page**, which opens today's entry or starts
one dated today. **Add weather and moon** (personal Journal) inserts one plain italic Markdown line
with the forecast and moon phase; it is ordinary text you can edit or delete.

Opening an entry shows it as a **page to read** with its notebook, tags, date, checklist progress and
an outline; **Edit** (pencil) switches to the editor, **Pin** and **Revision history** are icon
buttons, and **⋯ More actions** holds **Export Markdown**, **Copy as Markdown** and Archive/Restore.
Desktop editing puts the title and text on one page with **Details** (date, notebook chips, tag chips,
pin, autosave) and **Images & links** beside it; **×** leaves the editor (asking first about unsaved
changes).

**Markdown stays the source.** Every entry is stored as Markdown. **⋯ → Import Markdown files** in the library
accepts up to 50 `.md` files (200 KB each): front matter (`title`, `date`, `notebook`/`collection`,
`tags`, `pinned`) is read when present, otherwise the first `# heading` or the file name becomes the
title. Files exported from VMN import back unchanged. **⋯ → Export collection** downloads the entries matching the
search as ZIP, **Export complete archive** everything; images are not imported from Markdown files.

New notes use **CommonMark with GFM**: headings, formatting, tables, task checkboxes, quotes, links and
code. Use **Visual** or **Markdown source**; the selected mode is highlighted. Visual mode has a
visible formatting bar for bold, italic, headings, lists, quotes, Undo and Redo. On phones these use
compact labelled icons. Desktop keeps **Write**, **Details** and **Images & links** screens, with Visual/Markdown modes.
On a phone, a new entry starts with its **Title**, then **Next** opens visual writing, and **Next** opens
optional **Details** before **Save**. The bottom action bar uses arrow icons for Back/Next, a disk for
Save and × for Cancel, with accessible names. Back preserves the text between steps; Cancel leaves the
editor and asks before leaving unsaved changes. It does not delete an existing entry or recovery draft.
Date, collection/notebook suggestions, tags and pinning are in Details; Images & links is an optional
Details disclosure. **More formatting** opens quotes, Undo and Redo. An existing phone entry opens at
writing; Back returns to its title. Desktop editing remains available for unsupported source, shown as
a preserved read-only preview on phones. Successful server-awarded points can show an encouragement
overlay above the action bar when Gamification is enabled; moving between steps earns no points. Unsupported syntax stays intact in source mode rather than
being discarded. Existing entries stay plain text until you explicitly choose **Convert to Markdown**.
A title is required; dates are optional for new Markdown entries. Collections/notebooks, comma-separated
tags and pinning organize the library; search covers titles, text, collections and tags. Pinned entries
come first, followed by recently saved entries. **@ Link to a Workspace record** searches enabled,
authorized Workspace tools; it never searches personal Journals. **Outline** is optional.

**Save entry** publishes the current entry after server confirmation. **Autosave** is optional and off
initially. A valid, titled edit is saved separately as a recoverable server draft after a pause; the
status explicitly distinguishes a draft from a saved entry. There is one recoverable draft per person
per library. Recover or discard an existing draft before starting another; a draft for a different
entry is not overwritten automatically. Drafts are private to the author even in a shared library.
They are not an offline browser cache. A failed save preserves the editor text, and leaving unsaved
changes asks first. Shared stale writes are refused rather than overwriting another member's changes.

**Revision history** keeps saved versions, actor and time; restoring a version puts it in the editor
for review and Save. Archive/restore is reversible. Archived entries and saved revisions keep their
images and storage usage. Limits are 1,000 entries per library, 50,000 characters per body and 1,000
retained revisions per entry. Scope never changes in place: a personal entry cannot become shared.

**Images and originals** supports JPEG/PNG file selection, drag/drop and clipboard images, existing
accessible images, original downloads and preview regeneration. Originals are never compressed,
resized, stripped or overwritten; previews are separate metadata-free JPEGs. A clipboard original is
exactly the blob supplied by the clipboard, not an earlier camera file. Embedded metadata, including
possible location data, reaches anyone authorized to download a shared original. Remote image URLs
are not fetched. Other formats require their own validation before being added to this image service;
Documents retains its existing PDF/JPEG/PNG/HEIC support.

The initial image limits are **20 MB/file** and **500 MB/person**, across Notes and personal Journal.
Server admins can change them and set individual allowances. Originals plus retained previews and
thumbnails count; repeated references to the same attachment count once, independent uploads count
separately. Shared images also count toward Workspace storage. The image panel shows usage/remaining
capacity. Lowering a limit deletes nothing and preserves downloads. Removing a visible image keeps
files still used by history; unused provisional uploads are cleaned up after a day.

**Export Markdown** exports one entry as `.md`, or as ZIP with originals when images are included.
**Export collection** exports the current search/archive selection as a ZIP with UTF-8 Markdown,
relative attachment paths and metadata. **Export complete archive** includes both active and archived
entries, independent of the current search. Included Notes links resolve to exported Markdown files;
other internal links retain their readable label/reference. No running VMN is needed to read the
text or images. One export holds up to 2 GB of original images; use smaller search selections if your
configured allowance exceeds that export bound. Markdown/ZIP import, backlinks, diagrams, mathematics and footnotes are future work;
source mode preserves unsupported text today.

## Personal encouragement

A Workspace admin can switch **Gamification** on or off in **Workspace settings → Plugins**. New Workspaces start off; existing Workspaces keep their previous behavior after upgrading. It adds no menu destination. When off, useful actions still work, progress and completion status stay visible, and existing history and earned points remain. Actions accepted while off do not earn points later through undo/re-completion or re-enabling.

Where Gamification is on, useful additions and completed actions across tools earn private lifetime points once per record/action, up to **100 per UTC day**. Your Settings menu shows points in enabled Workspaces; Profile keeps your lifetime history available. **Profile → Gamification for my private Journal** is your separate account setting, independent of any Workspace (on by default). Points grant no access, have no monetary value and are not a leaderboard, ranking, streak or penalty. Undoing, restoring, re-completing or retrying an action never earns extra points. A Procedure Occurrence automatically closed by its Run does not earn a second completion award. Imported/restored history earns nothing.

After the server confirms earned points, the same celebration system serves every tool: randomly Herr Fuchsky, Count Duckula, Fester Fiesta, or confetti rising from the bottom. Character names appear beside them; confetti appears without a character. Dismiss celebrations at any time. Reduced motion stops character movement and hides confetti; ordinary points text remains. Guided Runs have no separate cheer or vibration, and normal step status and navigation work with Gamification off.

Scores and deduplication marks are account-private and excluded from Workspace backups; full server backups include them. The shared Gamification switch is included in Workspace backups; an older package without it restores off. Totals survive leaving a Workspace. No public or admin application view exposes another person's score. Zero-point opaque marks consume actions while off or capped, preventing later backfill rewards. Offline actions earn points only after server acceptance, under the settings then in force.


### Galactic Guide appearance

Choose **Galactic Guide** on that Workspace's tab under **Profile & settings → Appearance → Theme** for the optional space scene and floating everyday illustrations. Your current theme is kept until you choose another; System, the everyday themes, Tokyo Nights, Witch Forest and all Places remain available.

In **Profile & settings → Appearance → Interface and cards**, pick a Workspace, then choose **Glass** (plain), **Starfield**, **Forest**, **Water** or **Hearth** as its card background, set **0–100% background opacity**, switch decorative images on or off, and press **Save**. The same section sets the **Layout** (top bar or sidebar). Text and controls stay opaque and readable. **Cancel** restores saved values; **Reset** previews defaults until Save. These choices belong to that Workspace only: they are private to your account, other Workspaces keep their own, and they are not kept on the device, so while you are offline the Workspace shows the default until the server answers again. Places continues to use its own card-opacity/photo settings.

In Profile & settings → Dashboard, choose Celestial, Clock and Weather independently. By default only Celestial is shown among these three, and only when the Workspace enables it. Clock/Weather comes first when shown, followed by Celestial; other card choices remain yours. Clock and Weather share one illustrated card in both Guide and the existing interface. Its equal halves are whole-picture links to the dedicated screens, without separate text-link footers. One continuous, theme-aware surface sits behind the transparent Clock and Weather art, matching Celestial. The existing background-opacity slider in Appearance controls both cards; Places uses its existing personal Dashboard card-opacity slider. Only the background changes transparency, never the text, artwork or controls. Clear skies, rain/drizzle/showers, snow/sleet and thunderstorms use their matching illustrations; other or unknown conditions keep a weather symbol without inventing sunshine or precipitation. The written condition remains visible. A missing current condition uses the labelled daily outlook; an explicitly unknown condition stays unknown. If you choose only one usable instrument, it fills the card; if you choose neither, the card disappears. In Guide, the top bar shows the time when the Clock card is on. Open Clock or Open Weather in Dashboard settings works without enabling a tile. Each opens a full screen with Back and the shared action bar, rather than an overlay. Weather still uses your existing personal/location choices, server switch and scoped cached forecast; opening its screen requests a forecast, while leaving its tile off causes no automatic forecast request. No device location is used.

### Browse and illustrate the cookbook

Above the recipes, the filter bar holds the search field, the sort order (**Newest**,
**Recently changed** or **A–Z**), a switch between **Card view** (large photos) and **List
view** (compact rows), and **Show archived recipes**. Below it, tap one or more categories to
show only those recipes; a recipe appears when it has any of the chosen categories. **All**
clears the choice. The view you pick is remembered on this device.

Give a recipe its categories in the editor: open **Categories** and tick every one that fits.
The choices are Starter, Soup, Salad, Main course, Side dish, Dessert, Baking, Breakfast, Snack,
Sauce & dip, Drink and Cocktail. Tags stay free text for everything else.

The Recipes overview shows a cover photo, preparation and cooking time when entered, servings
and up to three tags. Cards and recipe details show **Private** or **Public** and the home
Workspace name, even when you open a shared recipe from a different Workspace. Open a card to
read the recipe and download the original photos.
For a new recipe, add a representative JPEG or PNG in **Images & links**. You can still save
and add the photo later. A recipe without a photo shows an illustration and offers **Add recipe
photo** to editors. Open **Manage recipe photos** on a pictured recipe to upload another photo
or choose its **Cookbook cover photo**, then save. The first local image is used by default.

New Recipes are shared with members of Workspaces that have Recipes enabled. To keep a Recipe
and its photos in its home Workspace, select **Private to this Workspace** before saving. Recipes
created before this setting was added and Recipes created through an AI connection start
Workspace-only. You can change visibility in the home Workspace. From another Workspace you can
read and export a shared Recipe or add its ingredients to a grocery list you can edit. To edit
the Recipe itself, open it in its home Workspace.

### Shop for a recipe

Open a recipe, choose a Shopping list and enter how many servings you want. Select
**Add ingredients** to copy the full recipe at that scale. For example, 125 g in a
two-serving recipe becomes 375 g for six. If the recipe has no serving count, VMN
shows a warning and adds the amounts as written. Phrases like “to taste” and exact
fractions that do not fit the numeric quantity field appear in the item name.

### Create and edit Recipes on a phone

Use **Title → Ingredients → Instructions → Details → Save recipe**. The bottom bar uses the same
icons as Notes, Journal and Procedures. **Back** keeps your draft; **Cancel** asks before discarding
unsaved changes. Nothing is autosaved.

On Ingredients, enter the base servings when known and tap an ingredient to expand its fields. Use the bottom
**Add ingredient** or **Remove ingredient** buttons; removal asks first and at least one ingredient
must remain. Instructions use the visual editor. Details holds optional preparation/cooking times,
tags, source and the **Private to this Workspace** setting, with **Images & links** for photos. Unsupported instruction syntax
is preserved in a preview; use the desktop editor to change that source. Desktop still offers the
complete form and Markdown source. Saving, exporting originals and transferring ingredients to a
shopping list keep their existing behavior.

### Reminders and scheduling on phones

New Reminders use **Title → Date & repeat → Optional details → Save**. Scheduling a Procedure starts
at the date because its title is already known. The bottom bar provides the same Back, Cancel, Next
and Save icons as other editors. Notes, the responsible person and notification offsets are in Details.
Back keeps your entries; cancelling or closing an edited form asks before discarding changes. Save
errors keep the draft available. Scheduling a Procedure never starts a Run automatically. Desktop
keeps the complete form; recurrence, time zones, notifications and permissions work as before.

On phones, **Add document** opens Files → Title → Details. Choose or photograph your pages, wait for
upload completion, then use the bottom Next arrow. Review the proposed title and optionally enter the
Folder, type, dates, tags and notes. The bottom Back arrow keeps your entries; Save document finishes.
Files are provisional until Save succeeds. Cancel asks before discarding selected files or typed details.
Desktop continues to show the complete form.

**Edit details** uses Title → Details → Save changes on phones. Back keeps your edits; Cancel or
Escape asks before discarding changes. **Move** stays a single Folder choice with the same bottom
icon controls. Desktop shows the complete modal forms. These actions do not alter original files.

Phone forms now share the same bottom Back, Cancel, Next and Save icons. Equipment separates its name,
model/replacement parts and optional details; Contacts separates name, phone/email and other details;
Maintenance and Bring separate their title from optional details. Desktop keeps the complete form.
Back preserves entered values; Cancel/Escape asks before discarding changes. A failed Save keeps your
work for retry. Lists uses a single screen for its small dialogs and keeps item and task entry inline.
The Dashboard stays card-based, Calendar offers the narrow-screen agenda, and Runs keep guided Section execution.

In a Note or personal Journal editor, **Home** returns to the current Workspace’s Dashboard. It appears in
the shared phone action bar and the desktop actions. Unsaved work still asks for confirmation; choosing
to stay preserves the editor and its current writing screen. Home is unavailable during a save and
does not save or complete an entry by itself.


### Recipe visibility defaults

New Recipes start as **Public**, including Recipes created through ChatGPT. Public
Recipes join the shared cookbook for signed-in VMN users with Recipes enabled in
a Workspace. Check **Private** to keep a Recipe in its home Workspace, or tell
ChatGPT to make the new Recipe private. Existing Recipes keep their current choice.
