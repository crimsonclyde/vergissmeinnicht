# User guide

This guide is for the people who *use* VergissMeinNicht (VMN). To install and run a server, see [Deployment](../admin/deployment.md).

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

- **Today** — progress and next actions: recent completions, unfinished executions, what is overdue and due today.
- **Procedures** — the reusable checklists: start, schedule, write and change them.
- **Reminders** — single things to remember, with a date.
- **Lists** — grocery lists.
- **Calendar** — an optional look ahead, by month or as an agenda.
- **Documents** — scans, PDFs and photos in folders. An optional tool: it is there only if a Workspace admin switched it on (see *Workspace settings*).
- **Contacts** — the people and organisations you deal with, with their numbers to call. An optional tool as well.
- **Maintenance** — work on the house: planned, in progress, completed or cancelled, on a board and in a list. An optional tool as well.

On a computer the tools are in the bar on the left, with the Workspace above them and **Settings** at the bottom. On a phone the Workspace and the **Settings** button (⚙) are at the top, and two to four destinations are at the bottom: **Today**, enabled **Procedures**/**Lists**, and **More** — More leads to Reminders, the Calendar, the completed history and — where it is switched on — Documents. Only enabled tools appear. Existing addresses still work while their tool is enabled; disabled tools answer as unknown resources. A new Workspace starts with all tools off: its admin can choose tools from Today. Switching a tool off keeps its data and storage usage for later.

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

**Photos in detail:** JPEG, PNG and WebP up to 10 MB. VMN stores a copy of at most 1600 pixels as JPEG, turned upright, with all hidden information removed (location, camera, time). iPhone photos (HEIC) are converted by the browser before they are sent (Safari and other iPhone browsers); if a browser cannot do that, VMN says so — then set *Settings → Camera → Formats → Most Compatible* or share the photo as JPEG. Photos count towards the Workspace's storage, together with its documents (5 GB unless an admin chose otherwise); the editor shows how much is used. When it is full, new photos are refused — existing ones stay. Deleted Procedures can be viewed and restored under **⋯ Manage Procedures → Deleted Procedures**.

## Today

Opening a Workspace shows **Today** — a few compact cards with what needs you now. A card appears only when its tool is switched on in the Workspace and it has something to show; on a quiet day Today is just **Nothing needs attention right now** (plus what is coming up, if anything). On a wide screen the cards stand in two columns: what to act on on the left, the rest beside it; on a phone they are one column.

- **Needs attention** — what is overdue (marked **Overdue**) and what is due today, with a count: a Reminder offers **Done**, a Procedure **Start**. Overdue dates stay until you complete or skip them; nothing is marked done by itself. If a repeating item is overdue several times, it is shown once ("3 overdue") with **⋯ → Skip the older ones…**. At most five are listed; **N more** leads to Reminders (or the Calendar).
- **Continue** — executions that are not finished, with how far they are and **Continue**.
- **Next up** — the next few dates within a week (*tomorrow*, *in 3 days*), with the way to the **Calendar**.
- **To buy** — grocery lists that still have something on them and how many items; tap one to open it.
- **Maintenance** — with the Maintenance tool on: planned work from today up to two weeks ahead, and planned work whose date has passed, with the linked equipment where Equipment is on. Tap one to open it. Read-only here; it never shows costs.
- **Recently completed** — what was finished in the last 3 days, newest first (at most five). A linked Run and its date count once; undoing a completion removes it.
- **Progress** (off unless you switch it on) — done today, this week and active, without zeros; *How this is counted* explains the time zones.
- **Calendar** (off unless you switch it on, with the Calendar tool) — the next few dates as a short agenda.
- **Weather** (off unless you switch it on, and only where your server admin allows weather) — the place you chose, current temperature and condition, today's high and low, rain (a chance where the provider gives one, otherwise an amount), tomorrow in a small line, and who supplied the forecast (e.g. *Open-Meteo · ItaliaMeteo ARPAE ICON-2I*). Tap it for the detailed forecast. If the forecast is older than usual (offline, provider down) it says *as of* and the time; after 6 hours it disappears.
- **Clock & date** (off unless you switch it on) — the time and date across the top of Today: large on a computer or wall tablet, one line on a phone. In your language and time zone; *Always 24-hour* if you prefer.
- **Customize Today** at the bottom leads to **Profile & settings → Today**, where you choose your own cards (see *Make it yours*).
- Each item shows the title and one line: when it is due and who is responsible (**Assigned to …** or **Shared**). **⋯** holds the rest: *Details* (Reminder or Procedure, how it repeats, its reminders), *Skip…* (with an optional reason), *Move this date…*, *Assign…*, *Link an execution…*, *Edit schedule…*, *Pause* / *Resume*, *End schedule…*.
- After **Done** a notice offers **Undo**.
- **All / Assigned to me / Shared** appears when Procedures or Reminders is enabled, and filters the cards (remembered in this browser).
- The full completed history is under **Procedures → ⋯ Manage Procedures → Completed history** (on a phone: **More → Completed history**).

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
- Changes by others appear within about ten seconds. If someone else edited the same item just before you, your edit is refused with a message instead of replacing theirs.
- **In the shop without a connection:** whenever you open VMN with a connection, **all lists of the Workspace** are kept on your device. Without a connection — also after reloading or reopening VMN — the lists open from your device ("Offline — showing the Lists saved on this device at …"). You can tick, untick, add, edit and remove items, and create, rename and delete lists; each change shows **Saved on this device · not sent yet** and is sent once, automatically, when the connection is back. **Undo** takes back a change that has not been sent yet.
- **When others changed the same thing meanwhile:** changes to different items always come together. For the same item (or a list's name) the **later change wins** — by when it was made, using your device's clock for changes made offline; a removed item or a deleted list wins over changes to it. Whenever your change was not applied, a short message says what happened and by whom.
- If your access changed while you were offline (no longer a member, no longer allowed to change lists, or Lists switched off), your waiting changes are **not** applied: they stay on your device with the reason until you choose **Discard these changes**.
- Signing out removes the lists and any unsent changes from the device (VMN asks first if changes are waiting). Browsers can delete stored website data on their own, especially on iPhones after long non-use — open VMN online now and then. VMN asks the browser to keep its data; whether it does is the browser's decision.
- **iPhone:** Safari and VMN added to the Home Screen keep **separate** data. Open the one you take shopping once with a connection before you need it offline.
- **Weak signal:** if the network does not answer within a few seconds, VMN opens from your device and keeps your changes there until the connection is good again.

## A new version of VMN

When the server was updated while VMN is open, a note says **A new version of VMN is available.** VMN never reloads by itself. **Reload now** appears when nothing is waiting on your device to be sent; if changes are still waiting, the note says they are sent first, and the button appears as soon as they are. Without a connection, reload once you are online again.
- Guests can read lists; Users, Editors and Admins can change them. A Workspace can have 100 lists with up to 300 items each.

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
- **Pages**: *Move up* / *Move down* change the order, *Remove page* takes a file out (it is then deleted), **Add files** adds pages. The order is the same for everyone.
- **⋯** on a document: *Edit details*, *Move* (to another folder), *Move to Trash*. **⋯** in a folder: *Rename*, *Move* (everything inside moves along; a folder cannot go into itself), *Select documents* (to move several at once), *Document types…* (your own types, such as "Condominium minutes"; a type you retire stays on the documents that have it), *Trash*, and *Move folder to Trash*.
- **Trash**: deleting moves a document, or a folder **with everything in it**, to Trash — right afterwards you can **Undo**. In **Trash** you can **Restore** it later, or open a deleted folder (*Show contents*) and restore only a part. Restoring tells you if something changed: when a folder with the same name exists now, the restored one is called "*Name* (restored)"; when the folder it was in is gone, it returns to the nearest folder that still exists, or to the top. **Nothing is removed from Trash automatically**, and what is in Trash still counts towards storage.
- **Links.** A document can be linked to a **procedure**, to a **reminder or scheduled procedure**, and to another **document** (for example a bill and its receipt). On the document, **Linked** lists them with where they stand ("In Trash", "This procedure was deleted", "Ended", the next due date); **Link to…** adds one, **Remove link** removes only the link. The procedure, and the reminder's *Details*, show **Linked documents**. A link is a reference: nothing is copied, and it gives nobody access to anything they could not open anyway.
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

- **Add a record:** type what needs doing and choose **Add as planned**. **More details…** opens the full form: category (for example *Heating*), the date it is planned for, a responsible contact (if Contacts is switched on), what it cost, and a description. Only the first field is required.
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

Choose **Add equipment** and enter a name — for example *Boiler*. Later, **Edit equipment** can add a category, location, manufacturer, model, serial number, purchase date, warranty expiry and notes. Categories, locations and manufacturers offer values already used in this Workspace. Search and filters find live records; **Show more** continues the list.

The detail page links existing manuals, receipts, warranties and photos in Documents, service Contacts, MaintenanceRecords and Procedures. Nothing is copied and a Link grants no access. Maintenance history shows its dates and statuses, newest first; completing maintenance remains a separate manual action. A deleted Contact is unnamed. Switched-off tools contribute no links or controls. On a MaintenanceRecord, **Link equipment…** adds the same reference; the Maintenance list also has an Equipment filter.

**Remind me 1 month before the warranty ends…** proposes a normal Reminder with the warranty expiry date and a one-calendar-month notification offset. Review the title, date, repetition and notifications before **Create reminder**. **Remind me…** also handles ordinary servicing reminders or scheduled Procedures. Generated reminder titles use only the Equipment name, never its serial number. Reminders appear in the ordinary Reminders and Calendar views when those tools are enabled.

Changing a warranty date changes no Reminder. If a Reminder is linked, VMN offers **Review reminder…**; only saving that separate dialog updates the Reminder. Disabling Equipment keeps its data and leaves ordinary Reminders running according to their own tool settings.

**Move to Trash** preserves the record and links; **Undo** restores it immediately, and **Equipment Trash** offers Restore later. Workspace admins can permanently delete from Trash with confirmation. Linked Documents, Contacts, MaintenanceRecords and Reminders survive; backups keep older copies until they rotate. Guests read all Equipment metadata, including serial numbers. Users, Editors and Admins manage records; only Admins delete permanently. Concurrent edits are refused instead of overwriting someone else’s work.

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

Reminders can come *on the due date*, *N days/weeks/months before* (at your default reminder time) or *N hours before* a timed date — up to 5. They go to the responsible person, otherwise to whoever created the schedule. If VMN was unavailable when a reminder was due and it is more than a day late, you get **one short summary** of what was missed ("Missed reminders: …") describing each item's current date and status — never a flood of old messages. Today and enabled Reminders/Calendar provide the reliable overview, whether a message arrived or not. Disabling Procedures or Reminders stops notifications for its own scheduled items and hides them; records and recurrence dates stay intact. Calendar disable only hides the view. Reenable catches up notifications from the last 24 hours and drops older notifications, without completing any item or flooding your channels.

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
- **Today** — your own Today: switch each card on or off, move it up or down, make it **Wide** (spans both columns on a large screen; phones always show one column), choose how many lists **To buy** shows (1–10), whether **Clock & date** is always 24-hour and how far back **Recently completed** looks (*Today*, *the last 24 hours*, *3 days* — the default —, *7 days* or *Off*), and **Compact** or **Comfortable** spacing. Every change is saved to your account at once (the page says *Saved.*) and applies in every Workspace; **Reset to default** brings back the standard layout. A card of a tool your Workspace does not use is marked *Not used in this Workspace* and never appears — choosing cards here never hides or shows a tool for anyone else. Your layout is kept on this device for offline use and deleted when you sign out.
- **Weather** — your own weather, independent of where you are: **search for a place** (the search is sent to Open-Meteo from the server) or **enter coordinates**, optionally an **elevation** (helps in hills and mountains), the **provider** (*Automatic* = Open-Meteo, then MET Norway; or one of them), and for Open-Meteo the **model** — only models that cover your place are offered, each with how many days it forecasts and what it lacks (e.g. *ItaliaMeteo ARPAE ICON-2I · 3 days · no rain probability*). Changing the place resets the model to Automatic; nothing else changes. With a chosen provider you can allow **another one if yours is unavailable** — it is then named on the card. °C or °F, tomorrow on or off. **Save weather settings** saves; the detailed 3-day forecast with its source, update time and attribution is below. Only you see these settings; your phone or browser never contacts a weather service — the server does, with your place rounded to about 1 km. Your browser's location is never used.
- **Appearance** — System (follows your device, also when it changes), Light, Dark or **Memento Mori** (pure black with crimson accents). Light and Dark look and work the same; only the colours differ. Saved to your account, so it follows you to every device.
- **Password & security** — change your password; two-factor authentication.
- **Confirmations** — how critical Steps are confirmed: press and hold, or tap then confirm.

## Workspace settings

**Settings → Workspace settings**:

- **General** — the Workspace's name (Admins can change it), **Tools** (Admins: switch **Procedures**, **Reminders**, **Lists**, **Calendar**, **Documents**, **Contacts**, **Maintenance** and **Equipment** on or off for the whole Workspace — switching one off hides it for everyone and keeps everything in it; there is no personal hiding), **Storage** (Admins: how much the Workspace stores — instruction photos, documents, previews, Trash — and of how much; you can set a lower limit of your own, never a higher one than the server admin allows; lowering it deletes nothing, it only refuses new files until less is stored), your role, and **Leave Workspace**.
- **Members** — who is in the Workspace and their role; Admins add members, change roles and remove members.
- **Sharing links** (Editors and Admins) — every Knot link, with **Revoke**.

## For server admins

**Settings → Server admin** (only shown to server admins), one section at a time:

- **Workspaces** — create a Workspace (you become its admin and add members under *Workspace settings → Members*).
- **Invitations** — invite people by email, send again, revoke.
- **Accounts & recovery** — disable an account (signs the person out everywhere at once) or enable it again; email a recovery link for a forgotten password or a lost authenticator.
- **Notification providers** — email reminders on/off and a test email to yourself; **Telegram**: paste the **Bot token** from @BotFather (checked with Telegram, stored encrypted, never shown again) and enable it — this sets up the bot for the whole server, not a destination chat. Then, like everyone else, connect your own chat under *Profile & settings → Notifications* (**Go to my notification settings**); only after that can **Send test message to my Telegram** reach you. You can also remove the token. See [Deployment](../admin/deployment.md#reminders-and-notification-providers).
- **Server & storage** — hide the page footer; how many **Recently used** Procedures the Procedures page shows (0–20, 0 hides them); **Workspace storage**: what each Workspace stores (instruction photos, documents, previews, Trash) and the most it may store — 5 GB by default, 100 MB to 1000 GB. A limit is a usage limit: no disk space is set aside, so keep an eye on the disk. Lowering a limit never deletes anything; new files are refused until usage is below it. **Document files**: the largest file a document may hold (1–100 MB, 50 MB by default) and the accepted formats — both apply to new uploads only.
- **Security log** — sign-ins, two-factor, recovery, invitations, account and membership changes.

## Planned changes

All implemented functional tools are selectable now. Mail remains planned and has no control. New text may use English where a translation is not yet available.
