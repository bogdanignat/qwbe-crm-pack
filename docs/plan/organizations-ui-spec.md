# UI Specification – Organizations (Accounts), vtiger CRM 5.4 → crm-pack

What the Organizations module looks like in vtiger CRM 5.4 today, and how crm-pack rebuilds it. Each area pairs the verified vtiger facts with the proposal, so the rebuild keeps what the users rely on and drops what they never use.

Source: the code in `vtiger-tools` (Smarty/templates, modules/Accounts, include/utils, include/js) and the local DB (SELECT statements only, counts only).
Basis: **61.347 active organizations** (`vtiger_crmentity.deleted=0`); 8.007 deleted (in the Recycle Bin).
Legend: **[vtiger 5.4]** = what exists today (fact verified in the code/DB) · **[modern proposal]** = suggestion for the rebuild.
UI labels are the `en_us` ones (the language of all 28 active users); the module is displayed as "Organizations", singular "Organization".
Numbers keep the source notation: a dot separates thousands (61.347), a comma marks decimals (69,6%). Data values (picklists, module names, filter names, mock records) stay exactly as they are in vtiger.

---

## Implementation rules

The code rules every step of this rebuild follows (they are also global rules for the projects):

- Small files with one responsibility each, under ~200 lines; a growing file is split into
  pieces with clear names, not grown further. The Organizations pieces live in
  `frontend/src/components/organizations/`.
- Logic (field grouping, ordering, labels, date formatting, payloads) lives in `src/lib` or in
  hooks, not in JSX. Components only render.
- Reusable components stay generic: a collapsible block or a field grid knows nothing about
  Organizations.
- TypeScript only. Styling with Tailwind classes only: no `style={{}}`, no new CSS files.
- UI primitives come from `src/components/ui` (shadcn/Radix); a missing one is added there in
  shadcn style without new npm packages. A primitive that would need a new package is raised
  first, not installed.
- Use what the project already has: react-query, react-hook-form, zod, lucide, sonner, the
  data provider and the existing hooks.
- Simple and readable top to bottom; no speculative abstraction.
- Mock fields are marked (MockTag), read-only and never sent to the API; demo records are
  read-only and never go to the backend.

---

## 1. Main menu

How users reach the modules: vtiger's header and tab groups, then the menu crm-pack shows. The menu decides what feels like "the CRM", so it follows vtiger's groups and drops the unused modules.

### 1.1 [vtiger 5.4] Header (`Header.tpl`)

The bar at the top of every vtiger page. It is the reference for the app's own header: search, quick create and the account menu.

```
+--------+------------------------------------------+---------------------------------------+
| LOGO   | [ global search ........... ][▼][🔍]     | <user>  [👤▼]  [ⓘ▼]  [⚙▼ admin only]  |
+--------+------------------------------------------+---------------------------------------+
| [🏠] Organizations | Contacts | Quotes | Documents | Vendors | Purchase Order |            |
|      Service Contracts | Devize | Products | Projects | More ▼ |  [Quick Create... ▼]      |
+--------------------------------------------------------------------------------------------+
| (marquee with the announcement, if the admin set an Announcement)                          |
+--------------------------------------------------------------------------------------------+
```

| Element | Behaviour [vtiger 5.4] |
|---|---|
| Logo | image from `test/logo/`, no link |
| Global search (Unified Search) | free text + a ▼ arrow that opens a popup with one checkbox per module (Select all / Unselect, Apply / Cancel); searches every checked module, results are grouped per module |
| User name | text |
| 👤▼ (user menu) | **My Preferences** (the user's own detail) · **Sign Out** |
| ⓘ▼ | **Help** (external vtiger wiki) · **Feedback** |
| ⚙▼ (admin only) | **CRM Settings** + the modules' on-demand links (without "Profile", "Plugin Setup") |
| Header links (`HEADERLINK`) | none registered in `vtiger_links` → the "More" menu on the right does not appear |
| Announcement | `marquee` scrolling the global announcement text |
| Top tabs | 🏠 Home icon + the first 10 modules with `tabsequence > 0` (the order above) |
| More ▼ | panel with columns grouped by `vtiger_tab.parent` (see 1.3) |
| Quick Create | `<select>` "Quick Create..." with "New <module>" for 22 modules (see 1.4) |

### 1.2 [vtiger 5.4] `vtiger_parenttab` / `vtiger_parenttabrel` groups (in order)

The menu groups vtiger stores in its database. They are listed only for completeness: the menu users see is built differently (§1.3).

The tables exist and are populated; the menu uses `vtiger_tab.parent` + `tabsequence` instead (the `getMenuStructure` function).

| # | Parent tab | Modules (parenttabrel order) |
|---|---|---|
| 1 | My Home Page | Home, Calendar, Webmails, MailManager |
| 2 | Marketing | Campaigns, **Accounts**, Contacts, Webmails, Leads, Calendar, Documents |
| 3 | Sales | Leads, **Accounts**, Contacts, Potentials, Quotes, SalesOrder, Invoice, PriceBooks, Documents, Calendar |
| 4 | Support | HelpDesk, Faq, **Accounts**, Contacts, Documents, Webmails, Calendar, Service Contracts, ProjectMilestone, ProjectTask, Project, (Timecontrol – inactive), PVS Intrări, Devize, PVS Ieșiri |
| 5 | Analytics | Reports, Dashboards |
| 6 | Inventory | Products, Vendors, PriceBooks, PurchaseOrder, SalesOrder, Quotes, Invoice, Services, Assets |
| 7 | Tools | Rss, Portal, Documents, PBXManager, SMSNotifier, Recycle Bin, Comments, (Messages, PHPListSync – inactive), PDF Maker, Integration, EMAIL Maker |
| 8 | Settings | – |

### 1.3 [vtiger 5.4] The effective menu

The menu vtiger actually shows, by area. It is the list crm-pack's sidebar is built from.

| Area | Modules |
|---|---|
| Top tabs (`tabsequence` order) | 1 Organizations · 2 Contacts · 3 Quotes · 4 Documents · 5 Vendors · 6 Purchase Order · 7 Service Contracts · 8 Devize · 9 Products · 10 Projects |
| More → Sales | Potentials (Opportunities), Leads, Sales Order, Invoice |
| More → Marketing | Campaigns |
| More → Support | HelpDesk (Tickets), FAQ, Assets, Project Milestones, Project Tasks, PVS Intrări (Procesverbalin), PVS Ieșiri (Procesverbalout) |
| More → Inventory | Price Books, Services |
| More → Analytics | Dashboards, Reports |
| More → Tools | Calendar, Emails, RSS, Portal, PBX Manager, SMS Notifier, Recycle Bin, Comments, PDF Maker, Mail Manager, Integration, EMAIL Maker |

### 1.4 [vtiger 5.4] Quick Create (modules with at least one `quickcreate=0` field, sorted alphabetically by tablabel)

The modules a record can be created in from the header without leaving the page. It tells which modules need a "+ New" entry.

Modules (the option is "New <singular>"): Accounts, Assets, Calendar (To Do), Campaigns, ModComments, Contacts, Devize, Documents, Events, HelpDesk, Leads, Potentials, PriceBooks, Products, Project, ProjectMilestone, ProjectTask, Procesverbalout, Procesverbalin, ServiceContracts, Services, Vendors (filtered by the user's EditView permission).

### 1.5 [modern proposal]

The crm-pack shell: a sidebar with collapsible groups, a command-palette search and a "+ New" menu. It keeps vtiger's groups so users find modules where they expect them.

```
+----------------+---------------------------------------------------------------+
| ☰ crm-pack     |  [⌘K Search anything...]              [+ New ▼]  [🔔] [Avatar▼] |
|----------------|---------------------------------------------------------------|
| ★ Favorites    |                                                               |
| Sales          |   content                                                     |
|  Organizations |                                                               |
|  Contacts      |                                                               |
|  Opportunities |                                                               |
|  Quotes/Orders |                                                               |
| Service        |                                                               |
|  Devize, PVS   |                                                               |
|  Contracts     |                                                               |
| Marketing      |                                                               |
| Reports        |                                                               |
| Settings(admin)|                                                               |
+----------------+---------------------------------------------------------------+
```
- Sidebar with collapsible groups (Sales, Service, Marketing, Inventory, Reports); unused modules (RSS, Portal, FAQ, Webmails) go away.
- Global search as a command palette (⌘K), with module filtering; "+ New" replaces Quick Create.
- Avatar menu: Preferences, Sign out; Help/Feedback move there.

---

## 2. Organizations list view

The page users open most: all organizations, searchable, filterable and sortable. The vtiger facts come first (§2.1–2.5), then what crm-pack built (§2.6).

### 2.1 [vtiger 5.4] Layout

How the vtiger list page is arranged, top to bottom. It is the layout §2.6 follows.

```
Organizations | [+] [🔍] | [📅][🕒][🧮][💬][⏱ Last Viewed] | [Import][Export][Find Duplicates] | [⚙ module settings]
+------------------------------------------------------------------------------------------------+
| Search  [Go to Advanced Search]   Search for [________] in [Organization Name ▼] [Search Now] [x]|
|  A B C D E F G H I J K L M N O P Q R S T U V W X Y Z                                           |
+------------------------------------------------------------------------------------------------+
| Showing Records 1 - 50 | Filters : [All ▼]  Create Filter | Edit | Delete      |« ‹ Page [1] › »|
| [Delete] [Mass Edit] [Send Mail] [Mailer Export] [Send SMS]   Select template to Mail Merge:[▼][Merge]
| [☐] | Organization No ▲▼ | Organization Name | Billing City | Website | Phone | Assigned To | Action |
| [☐] | ACC…              | <detail link>      | …            | <link>  | …     | <user>      | edit | del |
| … 50 rows / page …                                                                             |
+------------------------------------------------------------------------------------------------+
```

### 2.2 [vtiger 5.4] Toolbar (`Buttons_List.tpl`)

The buttons above the vtiger list and what each does. They show which list actions users expect to find.

| Button | What it does |
|---|---|
| ➕ Add | new EditView (Create Organization) |
| 🔍 Search | shows/hides the search panel |
| 📅 / 🕒 / 🧮 / 💬 | mini calendar, world clock, calculator, chat (all enabled in `config.inc.php`) |
| ⏱ Last Viewed | popup with the last 10 records visited (`history_max_viewed=10`) |
| Import | CSV import wizard (step 1: file; field mapping; duplicate handling) |
| Export | dialog: *Export with search records / Export without search records* × *Export all data / Export data in current page / Export selected records* → CSV |
| Find Duplicates | "MergeColumns" panel: pick the fields to compare → list of duplicate groups → Merge (record unification) |
| ⚙ | Module Manager → the module's settings (admin only) |

### 2.3 [vtiger 5.4] Filters (custom views)

vtiger's saved filters: a named set of columns, conditions and sorting, picked from a dropdown. They are the model for crm-pack's saved views.

**Picker:** `Filters : [<select>]` + the links `Create Filter | Edit | Delete` (Edit/Delete disabled on "All" and when the user lacks the right). On pending filters the admin also sees an approve/reject link (Approve/Deny).

**Filter editor** (separate page, `CustomView.tpl`):

| Step | Content |
|---|---|
| Details | *View Name* (required), ☐ Set as Default, ☐ List in Metrics (widget on Home), ☐ Set as Public |
| Step 2 – Choose Columns | 9 selects "column1..column9" (max. 9 columns), options grouped by block, required fields marked `*`, duplicate guard |
| Step 3 – Standard Filters (Simple Time Filter) | date column (Created Time / Modified Time) + duration: Custom (Start/End Date), Previous/Current/Next FY, Previous/Current/Next FQ, Yesterday/Today/Tomorrow, Last/Current/Next Week, Last/Current/Next Month, Last 7/30/60/90/120 Days, Next 30/60/90/120 Days |
| Step 4 – Advanced Filters | condition groups; each condition = field + operator + value; AND/OR between conditions and between groups |

Operators per type (`include/js/advancefilter.js`):

| Field type | Operators |
|---|---|
| text / email (V, E) | equals, not equal to, starts with, ends with, contains, does not contain |
| number (I, N, NN) | equals, not equal to, less than, greater than, less or equal, greater or equal |
| date / datetime (D, DT, T) | the numeric ones + between, before, after |
| checkbox (C) | equals, not equal to |

Codes stored in the DB: e, n, s, ew, c, k, l, g, m, h, bw, b, a.

**Filter statistics (DB):** 262 filters on Organizations, created by 34 users. Status: 0=default (1 filter, "All"), 1=private (148), 2=pending (59), 3=public (54).
Most used columns: Account Name 262, Billing State 228, Industry 220, Assigned To 208, Form 173, CUI 170, TVA 121, Email 96, Annual Revenue 68, Employees 65, Phone 54.
Most used conditions: industry *contains* 229, email1 *contains* 121, bill_state *contains* 94, employees *greater than* 25, annual_revenue *greater than* 22, emailoptout *equals* 22, assigned_user_id *contains* 21.

**The "All" filter (default):** Organization No · Organization Name · Billing City · Website · Phone · Assigned To (+ the Action column, added automatically).

**Representative filters (anonymized):**

| Filter | Status | Columns | Conditions |
|---|---|---|---|
| "Adăugate azi" | private | Account Name, Form, TVA, CUI, Assigned To, Industry, Billing State, Created Time | Standard: Created Time = Custom, from <date> to <date> (one day). Public variants: Last 7 Days, Last 30 Days |
| "Firme <Județ> cu email" | public | Account Name, Email, Phone, Fax, Billing State, Industry, Industry Spec, Other Industry, Email Opt Out | bill_state equals "<Județ>" AND emailoptout equals "no" AND accounttype not equal "Concurent" AND email1 contains "@" |
| "Construcții RO" | public | Account Name, Industry, Email, Other Email, Phone, Other Phone, Comp Mobile Phone, Email Opt Out, Type | email1 contains "@" AND industry contains "constructii" AND emailoptout equals "no" AND accounttype does not contain "concurent" AND annual_revenue > 227272.727 AND employees ≥ 30 |
| "Instalații electrice <Județ>" | pending | Account Name, CUI, Annual Revenue, Assigned To, Employees, Billing State | industry contains "Constructii - Instalatii electrice" AND bill_state contains "<Județ>" AND employees > 1 AND annual_revenue > 300000 |
| "Export newsletter" | private | Account Name, Email, Other Email, Email Opt Out, Type | emailoptout equals "no" AND accounttype does not contain "Concurent" AND email1 not equal "NULL" |

Note: there are series of 20+ nearly identical filters (the same 6 columns, 4 conditions, only the county/industry differs), most of them left pending.

### 2.4 [vtiger 5.4] Search

The ways the vtiger list can be searched. They set what the quick search and the filters should cover.

| Type | Details |
|---|---|
| Basic | `Search for [text] in [field]` + Search Now; the field list = the current filter's columns |
| Alphabetical | A–Z bar under the basic search: Organization Name *starts with* the letter |
| Advanced | the same condition builder as Advanced Filters (groups, AND/OR), without saving |
| Tooltip | hovering Organization Name shows TVA, CUI, Reg no (`vtiger_quickview`) |

### 2.5 [vtiger 5.4] Sorting, selection, paging

How the vtiger list is sorted, selected and paged. These are the habits the rebuilt list keeps.

| Aspect | Details |
|---|---|
| Sorting | click on the column header, toggles ASC/DESC; default **Modified Time DESC**; the order is kept in the session |
| Selection | one checkbox per row + "select all" on the page; after checking, "Select all N records in Organizations" / "Deselect all" appears (selection over the whole result) |
| Mass buttons (from `Accounts::getListButtons`) | **Delete** (mass delete, with confirmation) · **Mass Edit** · **Send Mail** (pick Email/Other Email → compose) · **Mailer Export** (exports organization + contact emails, Checked/Not Checked/ignore options per field) · **Send SMS** (custom SMSNotifier link) · **Mail Merge** (select from 2 Word templates + Merge) |
| Change Owner | defined in the code, but rendered only for Calendar; on Organizations the owner is changed through Mass Edit |
| Mass Edit | popup with every `displaytype=1` and `masseditable=1` field (all except Organization Name, Member Of, Organization No, Created/Modified Time); each field has an "apply" checkbox |
| Paging | **50 rows/page** (`list_max_entries_per_page`); «First ‹Prev Page [n] Next› Last»; total not precomputed (`LISTVIEW_COMPUTE_PAGE_COUNT=false`) |
| Row actions | the **Action** column: `edit` (EditView) · `del` (delete with confirmation) |
| Cells | Organization Name = link to the detail; Website = external link; Email = link to the email composer |
| Sidebar | **none** in the list view; the tag cloud appears only in the detail view |
| No records | "No Organization Found! You can create an Organization now" box + Create / Import link |

### 2.6 [modern proposal] – built in T-1813

The Organizations list as crm-pack built it. It keeps vtiger's columns, selection and paging, offers only what the backend honours, and marks everything that still waits for the backend.

vtiger's ListView in the app's own style (shadcn + Tailwind). Code: the generic
`frontend/src/components/cube-list.tsx` (pieces in `src/components/list/`, state in
`src/hooks/use-list-*.ts`, `use-row-selection.ts`, `use-cell-edits.ts`), configured for
Organizations in `src/components/organizations/organization-list.tsx` and
`src/lib/organization-list.ts`. Contacts uses the same list without selection or row menu.

```
Organizations
[View: All ▼] [Save view …]                                   (saved views, list-views)
[🔍 Name or industry starts with…] [Filters (1)] [Columns ▼]          [+ New Organization]
 chips: Search: "exe" ×   Industry: Construction ×   [Clear all]
 on the first tick: 2 selected [Clear selection] [Delete] [Mass Edit] [Send Mail]
                                                 [Mailer Export] [Send SMS]  (disabled)
+---+--------+-------------------+-----+---------+---------+---------+-------+--------+---+
|☐ | Org No | Organization Name↑| CUI | Billing | Billing | Website | Phone | Assign | ⋯ |
|   |        |                   |     | City    | State   |         |       | ed To  |   |
+---+--------+-------------------+-----+---------+---------+---------+-------+--------+---+
 demo rows on top (tinted, "demo" tag, checkbox disabled), then the server rows
 1-25 of 120 organizations (+3 demo)   [<] Page [1] of 5 [>]       Rows per page [25 ▼]
```

- **Columns.** Default: Organization No, Organization Name, CUI, Billing City, Billing State,
  Website, Phone, Assigned To (vtiger's "All" plus CUI and Billing State), labels as on the
  detail page, values formatted ro-RO. Fields added later (custom fields) stay hidden until
  picked. The **Columns** menu ticks fields on and off (new ones go to the right, the name
  cannot be removed), "Reset columns" returns to the default; the choice is kept per browser
  (`localStorage`). While a saved view is applied, its columns win, the picker edits them and
  "Reset columns" returns to the view's own, leaving the personal choice alone. Mock fields
  carry their marker in the header. External Id and Ownership (§7) are never offered.
- **Cells.** A website shows without `http(s)://` (`exemplu.test`); the link keeps the whole
  address, on the detail page too. The inline-edit pencil next to a link shows on the row's
  hover or keyboard focus (always on a touch screen), in space kept for it, so nothing shifts.
- **Quick search** is the contract's `q`: a prefix of name, industry or externalId, hence the
  placeholder. CUI, email and phone are not searchable in the list until the backend allows it
  (organizations-backend.md §3); the global search finds the demo rows by them.
- **Filters** opens the contract's exact filters (name, industry, externalId). Each active
  filter and the search shows as a chip with ×; "Clear all" clears them.
- **Sorting** on the server, on the sortable columns only (name, industry, createdAt today);
  ↑ / ↓ on the active one, `aria-sort` on the header.
- **Selection and mass actions.** A checkbox per row, named after the row ("Select Exemplu
  Construct SRL"), and "select all on this page", which shows a partial selection as mixed.
  The selection bar appears with the first tick and goes with the last; the selection
  resets when the query changes. Delete, Mass Edit, Send Mail, Mailer Export and Send
  SMS are disabled with the reason "Needs backend" in a tooltip. Demo rows cannot be selected;
  their checkbox says "Demo row, read-only" on hover and focus.
  "Select all N" over the whole result is not offered.
- **Row menu** ⋯: Open; Edit (opens the detail with every block in edit mode, `?edit=all`;
  unavailable on demo rows); Delete (disabled, "Needs backend").
- **Paging** 25 / 50 / 100, on the server. When everything is in view the label counts it
  ("3 organizations (3 demo)", "5 organizations (2 + 3 demo)"), else it gives the range and the
  total ("1-25 of 120 organizations (+3 demo)"). Changing the size keeps the first row in view;
  a page past the end falls back to the last one.
- **The query in the URL.** Search, filters, sort, page and page size live in the address
  (`?q=exe&f.industry=…&sort=-name&page=2&size=50`, defaults left out), so Back from a record
  and a reload keep the list where it was. Every value is checked on read; an unknown filter
  or sort field, a bad page or size falls back to the default. The applied saved view is not
  in the URL: after Back its query stays, its columns return to the personal choice.
- **Empty states.** No organizations: "No organizations yet." with "+ New Organization". No
  match: "Nothing matches the current search and filters." with "Clear search and filters".
- **Previous / next on the detail.** The list writes the ids of the page in view to the tab's
  `sessionStorage`; the detail opened from the list shows ◀ ▶ over that page (disabled at its
  ends). Opened directly, the arrows are not shown. Crossing pages needs the backend
  (organizations-backend.md §8).
- **Not built:** the A-Z letter bar (needs a name-prefix filter; `q` also matches the industry),
  Import / Export / Find Duplicates, the condition builder (operators), "Select all N".

---

## 3. Detail view

One organization on its own page: its fields in blocks, the related records and the actions. It is where users read and edit a record, so it follows vtiger's layout closely.

### 3.1 [vtiger 5.4] Header and tabs

The top of the vtiger detail page: the record's number and name, and the two tabs. It is the reference for the detail header and tabs (§3.6).

```
Organizations | [+][🔍] | … toolbar as in the list view …
[ ACC12345 ] Exemplu Construct SRL -  Organization Information   Updated 3 days ago (<user>)
+---------------------------------+-------------------+-----------------------------------------------+
| Organization Information        | More Information ▼| [Edit] [Duplicate] [Delete]  [◀] [⤓ jump] [▶] |
+---------------------------------+-------------------+-----------------------------------------------+
```

| Element | Details |
|---|---|
| Title | `[ <Organization No> ] <Organization Name> -  Organization Information` + "Updated … ago (user)" |
| Record no. | `account_no`, prefix **ACC** + numeric sequence (`vtiger_modentity_num`; form: ACC + 2–5 digits) |
| Buttons | **Edit**, **Duplicate** (prefilled EditView), **Delete** (confirmation) – top and bottom |
| Navigation | ◀ previous / ▶ next record of the current list + "jump" (dropdown list of records) (`DETAILVIEW_RECORD_NAVIGATION=true`) |
| Tabs | **Organization Information** (the blocks) · **More Information ▼** (the related lists page; the hover dropdown lists the 19 lists and jumps straight to one) |
| Caution | the More Information tab renders only if `$singlepane_view == 'false'`. In the local `config.inc.php` the variable **is not defined**, so in this installation the tab (and the inline related lists) do not appear; in standard vtiger 5.4 (`'false'`) they do. To be checked on production. |

### 3.2 [vtiger 5.4] Blocks and fields (vtiger order, 2-column layout)

Where every field sits on the vtiger detail page. Users find fields by place, so crm-pack keeps the same blocks and order.

Fields are laid out in pairs, in `sequence` order (left, right). `displaytype=2` fields (Created/Modified Time) appear only in the detail, read-only. Hidden: `modifiedby` (displaytype 3), `cf_716` Cod import (presence 1). The "Custom Information" block (id 10) **has no fields**, so it is not displayed.

```
+--------------------- Organization Information -----------------------+
| Created Time        | <dt>              | Modified Time      | <dt>   |
| Organization Name * | …                 | Other Industry     | …      |
| …                                                                    |
+----------------------------------------------------------------------+
```

**Block 1 – Organization Information** (`LBL_ACCOUNT_INFORMATION`)

| Row | Left (seq) | Right (seq) |
|---|---|---|
| 1 | Created Time (1) | Modified Time (2) |
| 2 | Organization Name * (5) | Other Industry (7) |
| 3 | Form * (9) | Other Industry Spec (10) |
| 4 | TVA * (12) | Type (13) |
| 5 | CUI * (14) | Rating (16) |
| 6 | Reg no (17) | Category (19) |
| 7 | Bank (20) | Product Category (21) |
| 8 | IBAN (22) | Assigned To * (23) |
| 9 | Phone (24) | Member Of (25) |
| 10 | Other Phone (27) | Ownership (28) |
| 11 | Comp Mobile Phone (30) | Annual Revenue (32) |
| 12 | Fax (33) | Employees (34) |
| 13 | Other Fax (35) | SIC Code (36) |
| 14 | Email (37) | Ticker Symbol (38) |
| 15 | Other Email (39) | Account Turnover (€) (40) |
| 16 | Website (41) | Notify Owner (42) |
| 17 | Industry * (43) | Email Opt Out (45) |
| 18 | Industry Spec (46) | Organization No (48) |

**Block 2 – Address Information** (`LBL_ADDRESS_INFORMATION`) + **Locate Map** button (Google Maps, pick Billing/Shipping)

| Row | Left | Right |
|---|---|---|
| 1 | Billing Address (1) | Shipping Address (2) |
| 2 | Billing PO Box (3) | Shipping PO Box (4) |
| 3 | Billing City (5) | Shipping City (6) |
| 4 | Billing State * (7) – county picklist | Shipping State (8) – **free text** |
| 5 | Billing Postal Code (11) | Shipping Postal Code (12) |
| 6 | Billing Country (13) | Shipping Country (14) |

**Block 3 – Description Information**: Description (full width, textarea).

**Below the blocks:** the **Comments** widget (ModComments: list + "Add Comment"; 758 comments on organizations in total).

### 3.3 [vtiger 5.4] Sidebar (right)

The box of actions beside the vtiger detail. It lists the shortcuts users expect next to a record.

| Section | Elements |
|---|---|
| Actions | **Send Mail** (pick the address) · **Add Event** · **Add To Do** |
| Custom links (DETAILVIEWBASIC) | **Add Note** (new Document linked to the organization) · **Show Organization Hierarchy** (Member Of tree) · **Send SMS** |
| EMAIL Maker widget | sending email from EMAILMaker templates (22 email templates in the system) |
| Tag cloud | "Tag it" input + the record's tag cloud (only if the user enabled it) |
| Mail Merge | select a Word template + **Merge** (2 templates for Organizations) |

### 3.4 [vtiger 5.4] Inline edit (ajax)

How vtiger edits one value without opening the form. crm-pack keeps this way of working.

- Active (`DETAILVIEW_AJAX_EDIT`, true by default). Hovering a value shows the edit cursor; click → inline input/picklist/checkbox + **Save** / **Cancel**, saved through `DetailViewAjax`.
- Read-only: Created/Modified Time, Organization No.
- On Organization Name it checks uniqueness ("Organization Name Already Exists!"). For CUI there is **no** check on inline edit (only in the edit form).

### 3.5 [vtiger 5.4] Related lists (the More Information page), in order

The records linked to an organization (contacts, deals, tickets and more), with how many exist. The counts show which related lists matter first.

| # | Label | Module | Actions | Linked records (DB) | In crm-pack |
|---|---|---|---|---|---|
| 1 | Contacts | Contacts | ADD | 61.478 contacts on 46.139 organizations (75%) | **Yes** (`Contact.organizationId`) |
| 2 | Potentials | Potentials (Opportunities) | ADD | 154 / 122 org. | No |
| 3 | Quotes | Quotes | ADD | 50.571 / 8.875 org. | No |
| 4 | Sales Order | SalesOrder | ADD | 9.048 / 3.362 org. | No |
| 5 | Invoice | Invoice | ADD | 8 / 6 org. | No |
| 6 | Activities | Calendar | ADD (Add Event, Add To Do) | see #8 | No |
| 7 | Emails | Emails | ADD (Send Mail) | 49.815 emails | No |
| 8 | Activity History | Calendar | – (list only) | Call 2.509 · Meeting 931 · Task 342 | No |
| 9 | Documents | Documents | ADD, SELECT | 42.624 / 7.638 org. | No |
| 10 | HelpDesk | HelpDesk (Tickets) | ADD | 0 | No |
| 11 | Products | Products | SELECT | 2 | No |
| 12 | Campaigns | Campaigns | SELECT (+ status per campaign) | 223.566 links / 47.547 org. | No |
| 13 | Services | Services | SELECT | 0 | No |
| 14 | Service Contracts | ServiceContracts | ADD | 1 | No |
| 15 | Assets | Assets | ADD | 0 | No |
| 16 | Projects | Project | ADD, SELECT | 19 | No |
| 17 | Procesverbalin (PVS Intrări) | Procesverbalin | ADD | ~22.436 | No |
| 18 | Devize | Devize | ADD | ~22.953 | No |
| 19 | Procesverbalout (PVS Ieșiri) | Procesverbalout | ADD | ~22.937 | No |

Each list has a header with the record count, the buttons `Add <Singular>` (ADD) / `Select <Module>` (SELECT, search popup), its own paging and the row actions `edit | del`; on the SELECT lists, `del` means unlink, not delete. Contacts columns (today): Last Name, First Name, Mobile, Email, Office Phone, Title, Assigned To.

### 3.6 [modern proposal] – built in T-1814

The detail page as crm-pack built it. It keeps vtiger's blocks and tabs, so users find each field where they always did.

The vtiger layout, two tabs and all, in the app's own style (shadcn + Tailwind).
Code: `frontend/src/components/organizations/` (layout data in `src/lib/organization-layout.ts`).

```
+------------------------------------------------------------------------------------+
| [ACC12345] Exemplu Construct SRL                       [Edit] [Duplicate] [Delete]  |
| Updated 02.11.2025, 17:40 by <user>                                                 |
| [Activ] [SRL]                                                                       |
+------------------------------------------------------------------------------------+
| [Organization Information] [More Information]        (?tab=more keeps the tab)     |
+---------------------------------------------------------+--------------------------+
| v Organization Information                              | Actions                  |
|   Created Time | <local dt> | Modified Time | <local dt>|   Send Mail (mailto:)    |
|   Organization Name | …     | Form | …                  |   Add Event        (off) |
|   …  (rows of §3.2 without the dropped fields, §5.2)    |   Add To Do        (off) |
| v Address Information  (billing only)                   |   Add Note         (off) |
| v Description Information  (full width)                 |   Send SMS         (off) |
| v Custom fields  (runtime custom fields only)           |                          |
|                                                         | Activity (comments feed) |
+---------------------------------------------------------+--------------------------+
More Information tab:
| v Contacts [n]                                                     [Add Contact]   |
|   Name | Mobile | Email | Office Phone | Title | Assigned To                        |
|   Showing 1-10 of n                                                  [<] [>]        |
| Sharing                                                                            |
```

- **Header:** `[Organization No] Name`, "Updated <local date and time> by <Last Modified By>"
  ("Created <date>" while the cube publishes no modification time), badges for Company status
  (`rating`) and Form (`legalForm`). Edit turns every editable value into its input under one
  Save/Cancel bar; Duplicate opens the create form prefilled (`/organizations/new?duplicate=<id>`,
  without the id, the bookkeeping columns, the mock fields, External Id and Organization No);
  Delete is disabled with a "Needs backend" tooltip. vtiger's ◀ / jump / ▶ navigation is left out.
- **Blocks:** collapsible (chevron in the header), all open by default; the open/closed state is
  remembered per block in the viewer's browser (localStorage). The vtiger 4-cell rows (right-aligned
  label, value, label, value) collapse to one column (label above value) when the block is narrow
  (phone width), read column by column: all the left fields, then all the right ones. The DOM has
  that order too, so tab order, screen readers
  and Edit follow what the reader sees at every width. Hidden: Id, Type, Deleted, External Id (technical; vtiger has no such field and
  Schema & API still shows it) and Last Modified By (it is in the header). A published field no
  block names joins the end of block 1; a runtime custom field the "Custom fields" block (until
  the metadata gives every field its group, organizations-backend.md §10). The fields dropped for
  a fill under 15% (§5.2) and Ownership (hidden in the UI, §7) are not shown: the rest of
  block 1 closes up two per row in vtiger's sequence, ending on Industry Spec and Organization No
  with no empty cell (a test keeps it so), and Address Information holds the billing address
  only, two fields per row.
- **Labels:** vtiger's en_us labels where the frontend supplies them: "Organization Name",
  "Created Time", "Billing Address", "Billing Postal Code", "Type", "Company status".
- **Mock markers:** a small icon after the label, with a tooltip and a screen-reader label, so the
  label stays on one line: MOCK (dashed circle) for a field the backend does not publish yet, bound
  for the cube; screen readers hear the full description. A mock is read-only and never sent.
- **Inline edit:** the pencil (and Copy) follow the value in space of their own (they never cover
  it) and appear on hover where there is a mouse, always on touch; only on real editable fields,
  never on mock fields or demo records. Phone, email and website stay links. While a draft is open
  the other tab is locked (save or cancel first), so no edit is dropped silently; the locked tab
  stays focusable and says why on hover and focus.
- **Dates and numbers:** one fixed locale, ro-RO (Europe/Bucharest), from `src/lib/locale.ts`,
  everywhere (header, detail, list, contacts, activity): 16.10.2026, 19:21 and 850.000, never raw
  ISO.
- **Currency:** one currency, EUR, for now: "Annual Revenue (EUR)". It
  will be configured at qwbe level 0.
- **Related lists:** only Contacts (`organizationId` filter), with a count, paging (10 per page)
  and "Add Contact" (`/contacts/new?organizationId=<id>`, organization preselected). The other 18
  lists of §3.5 are not shown until their modules exist (organizations-backend.md §8).
- **Sidebar:** on the first tab only, as in vtiger. Mail Merge, EMAILMaker and Show Organization
  Hierarchy (Member Of was dropped, §5.2) are left out.
- **Sharing:** on the More Information tab, under the related lists; the Schema & API panel stays
  below the tabs.
- The three demo organizations open read-only and send no request about the record: no pencils,
  Edit/Duplicate/Add Contact disabled; Duplicate of a demo id says "Demo records are read-only".
  ACC90001 (org_mock_001) lists two made-up contacts from the mock (Maria Proba, Ion Exemplu,
  read-only, no contact page). Sharing and Activity keep their place and layout as read-only
  previews marked DEMO, every control disabled ("Sharing is available on real organizations");
  no Schema & API panel.

---

## 4. Edit / Create

The form that creates or edits a whole organization. It decides which fields are required and which mistakes are caught before saving.

### 4.1 [vtiger 5.4] Form (`salesEditView.tpl`)

How the vtiger form is laid out. It mirrors the detail page, so users fill fields in the order they read them.

- The same 3 blocks and the same order as in the detail, without Created/Modified Time; Organization No appears read-only (auto-generated on create).
- **Assigned To**: **User / Group** radio + select (28 active users, 8 groups).
- **Member Of**: read-only field + organization selection popup + Clear.
- **Save** / **Cancel** buttons at the top and bottom.
- The address block has two radios: **Copy Shipping address** (shipping → billing) and **Copy Billing address** (billing → shipping).
- On create, Duplicate and Edit, Save first runs `formValidate()` (client), then an ajax `dup_check` call on **CUI** (`modules/Accounts/Save.php`):
  1. CUI already used by another non-deleted organization → alert "Organization Name Already Exists!" (the `LBL_ACCOUNT_EXIST` key is overridden in the language file, so the message talks about the name although it checks the CUI);
  2. CUI > 10 characters, non-numeric (the "RO" prefix is not accepted) or wrong check digit (key 753217532) → "This CUI is Invalid! Please be carefull!!!";
  3. otherwise the form is saved.
- On edit there is also a dialog asking to confirm propagating the address to the contacts ("Do you want to change the addresses of the Contacts related to this Organization?", which updates the addresses of all the organization's contacts). In the template the call goes through the `AddressSync` function, which **does not exist in the code**, so in practice the dialog does not appear. Observation from the code, not verified in the browser.

### 4.2 [vtiger 5.4] Required fields (`typeofdata ~M`)

The fields vtiger will not save without. They are the starting point for the rebuilt form's required fields.

Organization Name, Form, TVA, CUI, Assigned To, Industry, Billing State.
Note: TVA (checkbox, `C~M`) is marked required, but the client validation cannot enforce the check; in the data, 4.458 organizations have TVA = 0.

### 4.3 [vtiger 5.4] Visible validations

The checks vtiger runs before saving, with their messages. They show which mistakes users are used to being warned about.

| Rule | Fields | Message |
|---|---|---|
| required | the 7 above | "<label> cannot be empty" / "cannot be none" |
| email | Email, Other Email (`E~O`) | invalid email format |
| integer | Employees, Annual Revenue, Member Of (`I~O`) | "invalid" |
| numeric | Account Turnover (€) (`NN~O~10,0`) | numeric, no decimals |
| declared length `LE~N` | CUI 20, Reg no 20, IBAN 50, Industry Spec 50, Other Industry Spec 255, Comp Mobile Phone 15, Other Fax 15 | in `general.js` the `V` type does not check the length; the real limit is the DB column (varchar) |
| CUI | CUI | server: unique + check digit (see 4.1) |
| unique name | Organization Name | inline edit only |

### 4.4 [vtiger 5.4] Quick Create (popup from the header), in `quickcreatesequence` order

The short form vtiger opens from the header. Its fields are the minimum an organization is created with.

| # | Field | Required |
|---|---|---|
| 1 | Organization Name | yes |
| 2 | Phone | – |
| 3 | Website | – |
| 4 | Assigned To | yes |
| 5 | IBAN | – |
| 6 | SIC Code | – |
| 7 | Billing City | – |
| 8 | Form | yes |
| 9 | TVA | yes |
| 10 | Industry | yes |
| 11 | Billing State | yes |
| 12 | CUI | yes |

Observation from the code: Save in Quick Create calls `AjaxDuplicateValidate('Accounts','accountname',…)`, which sends the name, not the CUI. Save.php validates `cf_666` from the request (missing), so it answers "CUI invalid" and the record is not saved. Not verified in the browser.

### 4.5 [built, T-1815] The organization form

What the rebuilt form does today. One form serves create, Duplicate and the detail's Edit all, so the three never drift apart; the rules below apply to every field the backend publishes as editable.

- **Layout:** vtiger's 3 blocks in the detail's order and rows (Organization Information,
  Address Information, Description Information), without Created/Modified Time and without
  the dropped fields (§5.2); Address holds billing only, so vtiger's address copy is gone.
  Two label/value columns that fold to one
  when the form is narrower than 42rem (a phone). The blocks are not collapsible. **Save / Cancel** sit
  above and below the blocks.
- **Where:** `/organizations/new` ("New organization"); `/organizations/new?duplicate=<id>`
  ("Duplicate organization", started from the source's editable values, without
  `externalId` and Organization No); the detail's **Edit** (`?edit=all`), which replaces the
  first tab with the form, full width, as vtiger's edit view drops the sidebar. The pencil on
  a single field still edits it in place.
- **Controls:** Industry (P4), Type (P3) and Company status (P5) are selects with vtiger's
  values, attached in the UI until the backend publishes them as `enum`; the same select
  serves create, Edit all, the detail's pencil and the list cell. A stored value the list
  lacks (an older Industry, for instance) stays first in the list, shown as-is, so it is
  never blanked out. Ownership is hidden, as on the detail (§7). Every boolean, editable or
  not, is a checkbox, as in vtiger. On create, Organization No carries the hint "Generated on
  save once the backend numbers records".
- **Mock fields** (MOCK marker) show as disabled inputs or checkboxes, with their
  marker and, on Edit, the value they hold. They are not part of the form and never travel
  in a POST or PATCH. **Assigned To** is one of them: it shows disabled until the backend
  publishes it, then it takes the existing user picker (a relation input).
- **Required:** the 7 fields of §4.2 carry a red asterisk and `aria-required`. Only the real
  editable ones are enforced: Organization Name and Industry today (Industry is required by
  vtiger although the metadata says optional). TVA is a checkbox, so it is marked but never
  refused, as in vtiger. A field the metadata marks required is always required too.
- **Checks** (pure functions in `lib/`, wired by field name, so each applies on its own once
  its field becomes real):
  - **CUI:** digits only, 2 to 10 of them, check digit with the key 753217532. The **RO
    prefix is refused** with a hint ("Enter the CUI without the RO prefix: digits only"),
    not stripped, as vtiger refuses it; the user sees what is stored.
  - **Email:** the fields with the email format (Email), `name@domain.tld`.
  - **Whole numbers:** every integer field (Employees today).
  - **Lengths:** the metadata's `maxLength` when published, else the declared lengths of
    §4.3 that remain (CUI 20, Reg no 20, Industry Spec 50, Comp Mobile Phone 15).
  Errors show inline under the field on blur and on Save; a refused Save moves the focus to
  the first invalid field and sends nothing. The backend's own refusal shows above the form.
- **Unsaved changes:** with a changed form, leaving through a link, Cancel or a page reload
  or close asks "Leave this page? Your changes are not saved." Once the save went through
  the prompt is off, so opening the new record never asks. The browser's Back button is not
  guarded (Next's App Router has no route-change hook).
- **Not built:** the CUI uniqueness check with a link to the existing organization and
  "Fill from ANAF" (name, address, Trade Register no., VAT) need a backend.

---

## 5. Table of fields missing from the cube

Which vtiger fields crm-pack already has, which are missing, and the picklist values. It is the list the backend works from (organizations-backend.md §1).

### 5.1 Fields the cube already has (coverage)

The vtiger fields the crm-pack cube already stores, with how often vtiger has them filled. They need no backend work.

| crm-pack | vtiger fieldname | vtiger label | Fill | Notes |
|---|---|---|---|---|
| id | accountid (crmid) | – | 100% | |
| externalId | – (probably accountid/crmid from vtiger) | – | – | to be confirmed with the crm-pack team |
| name | accountname | Organization Name | 100% | max 100 characters, required |
| organizationNo | account_no | Organization No | 100% | ACC + number, auto-generated |
| phone | phone | Phone | 69,6% | |
| email | email1 | Email | 46,0% | |
| website | website | Website | 27,1% | |
| organizationType | accounttype | Type | 100% | custom RO values (see P3) |
| industry | industry | Industry | 100% | required; 123 values (see P4) |
| rating | rating | Rating | 99,9% | here it means **legal status** (see P5); proposed UI label "Company status" |
| ownership | ownership | Ownership | 0,5% | free text with people's names, see §7; hidden in the UI, removal requested from the backend |
| employees | employees | Employees | 53,6% | integer |
| emailOptOut | emailoptout | Email Opt Out | 0,2% checked | checkbox |
| billingStreet | bill_street | Billing Address | 92,2% | max 250 |
| billingCity | bill_city | Billing City | 99,1% | max 30 |
| billingCode | bill_code | Billing Postal Code | 70,6% | max 30 |
| billingCountry | bill_country | Billing Country | 88,8% | text, 33 distinct values, ~89% "Romania" |
| description | description | Description | 58,8% | long text |
| createdAt | createdtime | Created Time | 100% | |

### 5.2 Missing fields (presence 0,2), in vtiger order

The vtiger fields the cube does not have yet, with type, length and how often they are filled. The fill rate helps decide what to port and what to drop.

Fill = % of 61.347. Length = the declared `LE~N`, otherwise the DB column.
The table stays the vtiger reference. A row marked **dropped (<15%)** is not ported (Bogdan's
decision, 2026-10-17, organizations-backend.md §1): it is filled on fewer than 15% of the
organizations, so the UI does not show it; a client who needs it adds it as a custom field.
Shipping Country counts with the street (7,9%): its 50,8% is the "Romania" default. The 15 kept
rows are the cube's missing fields.

| vtiger fieldname | Label | Block | Seq | uitype → type | Req. | Length | Picklist | Fill | Proposed name |
|---|---|---|---|---|---|---|---|---|---|
| modifiedtime | Modified Time | Org. Info | 2 | 70 → datetime (read-only) | – | – | – | 100% | modifiedAt |
| cf_675 | Other Industry | Org. Info | 7 | 15 → picklist | no | 255 | P6 (83) | 1,5% | dropped (<15%) |
| cf_658 | Form | Org. Info | 9 | 15 → picklist | **yes** | 255 | P1 (29) | 100% | legalForm |
| cf_676 | Other Industry Spec | Org. Info | 10 | 1 → text | no | 255 | – | 1,2% | dropped (<15%) |
| cf_665 | TVA | Org. Info | 12 | 56 → checkbox | yes (formal) | – | – | 92,7% checked | vatPayer |
| cf_666 | CUI | Org. Info | 14 | 1 → text (digits) | **yes** | 20 (validation: ≤10 digits + check digit) | – | 100% | cui |
| cf_670 | Reg no | Org. Info | 17 | 1 → text | no | 20 | – | 73,9% (85% of them start with "J", <1% with "F") | tradeRegisterNo |
| cf_679 | Category | Org. Info | 19 | 15 → picklist | no | 255 | P7 (4) | 88,9% | customerCategory |
| cf_706 | Bank | Org. Info | 20 | 15 → picklist | no | 255 | P8 (53 unique) | 6,1% | dropped (<15%) |
| cf_692 | Product Category | Org. Info | 21 | 15 → picklist | no | 255 | P9 (102) | 4,1% | dropped (<15%) |
| cf_638 | IBAN | Org. Info | 22 | 1 → text | no | 50 | – | 5,0% | dropped (<15%) |
| assigned_user_id | Assigned To | Org. Info | 23 | 53 → user/group reference | **yes** | – | 28 active users + 8 groups; 60 distinct owners in the data | 100% | assignedTo `{type:"user"\|"group", id, name}` |
| account_id (parentid) | Member Of | Org. Info | 25 | 51 → account reference | no | – | – | 12 org. (0,02%) | dropped (<15%) |
| otherphone | Other Phone | Org. Info | 27 | 11 → phone | no | 30 | – | 19,5% | otherPhone |
| cf_677 | Comp Mobile Phone | Org. Info | 30 | 11 → phone | no | 15 | – | 28,6% | mobilePhone |
| annual_revenue | Annual Revenue | Org. Info | 32 | 71 → currency (integer, base currency EUR) | no | int | – | 35,5% (>0) | annualRevenue |
| fax | Fax | Org. Info | 33 | 11 → phone | no | 30 | – | 36,1% | fax |
| cf_678 | Other Fax | Org. Info | 35 | 1 → text (phone) | no | 15 | – | 1,2% | dropped (<15%) |
| siccode | SIC Code | Org. Info | 36 | 1 → text | no | 50 | – | 64,3% | caenCode (holds "NNNN Activity description") |
| tickersymbol | Ticker Symbol | Org. Info | 38 | 1 → text | no | 30 | – | **0%** | dropped (<15%) |
| email2 | Other Email | Org. Info | 39 | 13 → email | no | 100 | – | 6,1% | dropped (<15%) |
| cf_681 | Account Turnover (€) | Org. Info | 40 | 7 → integer (`NN`, 10 digits) | no | decimal(11,0) | – | 8,9% (>0) | dropped (<15%) |
| notify_owner | Notify Owner | Org. Info | 42 | 56 → checkbox | no | – | – | **0%** | dropped (<15%) |
| cf_703 | Industry Spec | Org. Info | 46 | 1 → text | no | 50 | – | 20,2% | industrySpec |
| modifiedby | Last Modified By | Org. Info | 49 | 52 → user reference (hidden in the UI, displaytype 3) | – | – | – | – | modifiedBy |
| bill_pobox | Billing PO Box | Address | 3 | 1 → text | no | 30 | – | 2,4% | dropped (<15%) |
| bill_state | Billing State | Address | 7 | 15 → picklist (county) | **yes** | 30 | P2 (43) | 100% | billingState |
| ship_street | Shipping Address | Address | 2 | 21 → textarea | no | 250 | – | 7,9% | dropped (<15%) |
| ship_pobox | Shipping PO Box | Address | 4 | 1 → text | no | 30 | – | 0,03% | dropped (<15%) |
| ship_city | Shipping City | Address | 6 | 1 → text | no | 30 | – | 7,1% | dropped (<15%) |
| ship_state | Shipping State | Address | 8 | 1 → **free text** | no | 30 | (48 distinct values in the data) | 7,2% | dropped (<15%) |
| ship_code | Shipping Postal Code | Address | 12 | 1 → text | no | 30 | – | 2,1% | dropped (<15%) |
| ship_country | Shipping Country | Address | 14 | 1 → text | no | 30 | – | 50,8% (filled with "Romania" by default; the street exists in only 7,9%) | dropped (<15%) |

Outside the blocks: `campaignrelstatus` (Status, uitype 16, picklist with 4 values), used only as the organization's status in a campaign's related list; it is not a field of the record. Proposed name: `campaignStatus` on the campaign–organization relation.

Values in the data that are not in the picklist (worth knowing for the mock/validation): industry 92, Form 21, Bank 451 (81 distinct values in the data against 53 in the list), Product Category 156, Other Industry 150, Billing State 21. "--None--" is stored as a real value in Rating (81), Category (107), Form (21).

### 5.3 Picklist values (real, in the order shown in the UI)

The real values of every dropdown, in vtiger's order. The mock and, later, the backend use exactly these values.

**P1 – Form (cf_658), 29 values + "--None--":**
SCM, SRL-D, SAG, SNC, SCS, SCA, IF, II, RA, fara, CMI, CMA, CMG, SM, SCM1, SCM2, UC, BNP, BEJ, CA, CAA, SCPA, SPRL, ASF, CS, PFA, SA, SRL, Primarie.
Distribution: SRL 53.822 · SA 3.478 · fara 2.372 · II 436 · PFA 265 · SCM 186 · SCM1 150 · RA 132 · SRL-D 105 · SNC 92 · the rest < 80.

**P2 – Billing State (bill_state), 43 values:**
Alba, Arad, Arges, Bacau, Bihor, Bistrita Nasaud, Botosani, Braila, Bucuresti, Brasov, Buzau, Calarasi, Caras Severin, Cluj, Constanta, Covasna, Dambovita, Dolj, Galati, Giurgiu, Gorj, Harghita, Hunedoara, Ialomita, Iasi, Ilfov, Maramures, Mehedinti, Mures, Neamt, Olt, Prahova, Salaj, Satu Mare, Sibiu, Suceava, Teleorman, Timis, Tulcea, Valcea, Vaslui, Vrancea, CE (= abroad/EC).

**P3 – Type (accounttype), 12 values, default "Altele":**
Client potential, Client ocazional, Client frecvent, Revanzator, Integrator, Partener, Administratie, Concurent, Investitor, Analist, Media, Altele.
Distribution: Client potential 48.365 · Altele 10.963 · Client ocazional 853 · Concurent 786 · Integrator 200 · Client frecvent 116 · Partener 17 · Revanzator 15 · Administratie 3 · Analist 2.

**P4 – Industry (industry), 123 values.** The first 20:
Administratie - Asistenta Sociala, Pensii, Somaj, Mediu, Case Sanatate · Administratie - Finante Publice, Directii, Servicii, Vami, Altele · Administratie - Guvern, Prefecturi, Ministere, Armata, Politie, Servicii · Administratie locala - Primarii, Consilii locale, Altele · Agrement - Cluburi, Cazinouri, Baruri, Centre recreative, Parcuri · Agricultura - Asociatii si Ferme agricole · Agricultura - Cresterea animalelor · Agricultura - Cresterea pasarilor · Agricultura - Gospodarii agricole individuale · Agricultura - Horticultura, Plante de gradina · Agricultura - Hrana pentru animale, Nutreturi · Agricultura - Legumicultura, Sere · Agricultura - Piscicultura · Agricultura - Viticultura, Pomicultura · Comert - Combustibili, Benzinarii · Comert - Confectii Textile Pielarie · Comert - Electronice, Electrocasnice · Comert - Malluri, Supermaketuri, Baze aprovizionare · Comert - Materiale de constructii, Chimice · Comert - Mobila si decoratiuni interioare.
Structure: "Domain - Subdomain"; domains: Administratie, Agrement, Agricultura, Comert, Comert Specializat, Comunicatii, Constructii, Cultura, Educatie, Finante, Industria Lemnului, Industrie (Alimentara, Auto, Chimica, Electrotehnica, Energetica, Mecanica, Metalurgica, Pielarie, Textila), Juridic, Marketing, Materii prime, Media, Organizatii NGV, Productie, Publicitate, Sanatate, Servicii, Servicii Publice, Silvicultura, Sport, Turism. The picklist is role-based: e.g. the "Director General" role sees 112 values. 11 values are duplicates with "–" (en dash) instead of "-".

**P5 – Rating (rating), 9 values, default "Activ":**
Activ, Inactiv, Restrictionat, Dizolvat/Radiat, Lichidare, Insolventa, Restructurare, Litigiu cu GT, Tepar.
Distribution: Activ 60.223 · Dizolvat/Radiat 577 · Inactiv 372 · --None-- 81 · Lichidare 16 · Insolventa 8 · Restructurare 5 · Tepar 2 · Restrictionat 1 · Litigiu cu GT 1.

**P6 – Other Industry (cf_675), 83 values** (dropped with its field, §5.2). Same structure as P4 (a slightly different subset). The first 20:
Agrement - Cluburi, Cazinouri, Baruri, Centre recreative, Parcuri · Agricultura - Asociatii si Ferme agricole · Agricultura - Cresterea animalelor · Agricultura - Cresterea pasarilor · Agricultura - Gospodarii agricole individuale · Agricultura - Horticultura, Plante de gradina · Agricultura - Hrana pentru animale, Nutreturi · Agricultura - Legumicultura, Sere · Agricultura - Piscicultura · Agricultura - Viticultura, Pomicultura · Comert - Combustibili, Benzinarii · Comert - Confectii Textile Pielarie · Comert - Diverse · Comert - Electronice, Electrocasnice · Comert - Malluri, Supermaketuri, Baze aprovizionare · Comert - Materiale de constructii, Chimice · Comert - Mobila si decoratiuni interioare · Comert - Produse alimentare · Comert Specializat - Masini, Echipamente, Utilaje · Comert Specializat - Scule, Unelte, Accesorii.

**P7 – Category (cf_679), 4 values:** Normal, Silver, Gold, Platin. Distribution: Normal 54.388 · empty 6.788 · --None-- 107 · Silver 47 · Gold 17.

**P8 – Bank (cf_706)** (dropped with its field, §5.2). The table has 191 rows with duplicates; **53 unique values**:
Alpha Bank - BUCU, Anglo Romanian Bank - ARBL, ATE Bank Romania - MIND, Banc Post - BPOS, Banca Centrala Cooperatista Creditcoop - CRCO, Banca Comerciala Carpatica - CARP, Banca Comerciala Romana - RNCB, Banca CR Firenze Romania - DARO, Banca Italo Romena - BITR, Banca Millenium - MILB, Banca Nationala A Romaniei - NBOR, Banca Romana Pentru Dezvoltare - BRDE, Banca Romaneasca - BRMA, Banca Transilvania - BTRL, Bank Leumi Romania - DAFB, Bank Of Cyprus Romania - BCYP, BCR Banca pentru Locuinte - BCRL, Blom Bank France Romania - BLOM, Caja De Ahorros Y Pensiones Barcelona - CAIX, CEC Bank - CECE, Citibank Romania - CITI, Credit Europe Bank Romania - FNNB, Danske Bank Copenhagen - DABA, Depfa Bank Plc Dublin Bucuresti - DPFA, Emporiki Bank Romania - BSEA, Eximbank - EXIM, Fortis BankNv Bruxelles Bucuresti - FTSB, Frankfurt Bucharest Bank - FRBU, Garantibank International Nv - UGBI, HVB Banca Pentru Locuinte - HVBL, ING Bank Romania - INGB, Intesa San Paolo Romania - WBAN, Libra Bank - BREL, Marfin Bank Romania - EGNA, MKB Romexterra - CRDZ, National Bank Of Greece - ETHN, Nova Bank - BCUN, OTP Bank Romania - BNRB, Piraeus Bank Romania - PIRB, Porsche Bank - PORL, Procredit Bank - MIRO, Raiffeisen Banca pentru Locuinte - RZBL, Raiffeisen Bank Romania - RZBR, RBS Bank Romania - ABNA, Romanian International Bank - ROIN, Transfond - TRFD, Trezoreria Statului - TREZ, Unicredit Tiriac Bank - BACX, Volksbank Romania - VBBU, Bank Leumi Romania, Banca Feroviara, ING Bank - ING, Piraeus Bank.
Per role: most roles see 7–16 values.

**P9 – Product Category (cf_692), 102 values** (dropped with its field, §5.2). Format "Group - Subgroup". The first 20:
Aer comprimat - Accesorii si consumabile · Aer comprimat - Compresoare cu piston industriale · Aer comprimat - Compresoare cu piston profesionale · Aer comprimat - Compresoare cu surub · Aer comprimat - Compresoare de uz medical · Aer comprimat - Motocompresoare · Aer comprimat - Piese de schimb · Aeroterme - Aeroterme directe · Aeroterme - Aeroterme indirecte · Aeroterme - Electrice · Aeroterme - Piese de schimb · Aparate de sudura - Accesorii si consumabile · Aparate de sudura - Generatoare · Aparate de sudura - Invertoare · Aparate de sudura - MIG-MAG · Aparate de sudura - MMA · Aparate de sudura - Oxyacetilenica, Oxygaz · Aparate de sudura - Piese de schimb · Aparate de sudura - Puncte · Aparate de sudura - Taiere Plasma.
Groups: Aer comprimat, Aeroterme, Aparate de sudura, Baterii de condensatoare, Echipamente constructii, Echipamente de curatenie, Echipamente de ridicat si stivuit, Echipamente pentru tratarea apelor, Echipamente service auto, Grupuri electrogene, Inchiriere, Instrumente de masura, Motoare termice, Panouri solare incalzire, Pompe, Scule de mana, Scule electrice, Scule pneumatice, Stabilizatoare de tensiune, Surse neintreruptibile, Utilaje/echipamente agricole, Alte produse.

**P10 – campaignrelstatus:** 4 values (the organization's status in a campaign).

---

## 6. Mockup JSON (made-up data)

The made-up records and fields the UI shows until the backend has them. They let the pages be built and reviewed without real customer data.

The values are fictitious and checked as absent from the DB (names, CUI, Trade Register no., phones, email domain). The picklist values are the real ones.

```json
[
  {
    "id": "org_mock_001",
    "externalId": "mock-1001",
    "organizationNo": "ACC90001",
    "name": "Exemplu Construct SRL",
    "legalForm": "SRL",
    "cui": "99000001",
    "vatPayer": true,
    "tradeRegisterNo": "J99/0001/2020",
    "organizationType": "Client frecvent",
    "rating": "Activ",
    "customerCategory": "Gold",
    "industry": "Constructii - Instalatii electrice",
    "industrySpec": "Instalatii joasa tensiune",
    "caenCode": "4321 Lucrari de instalatii electrice",
    "phone": "0700 000 001",
    "otherPhone": null,
    "mobilePhone": "0700000101",
    "fax": null,
    "email": "office@exemplu.test",
    "website": "www.exemplu.test",
    "emailOptOut": false,
    "employees": 42,
    "annualRevenue": 850000,
    "assignedTo": { "type": "user", "id": "u_mock_07", "name": "Agent Vanzari 1" },
    "billingStreet": "Str. Exemplului nr. 10",
    "billingCity": "Cluj-Napoca",
    "billingState": "Cluj",
    "billingCode": "400000",
    "billingCountry": "Romania",
    "description": "Client recurent pentru service generatoare.",
    "createdAt": "2019-03-14T09:12:00Z",
    "modifiedAt": "2025-11-02T15:40:00Z",
    "modifiedBy": { "id": "u_mock_07", "name": "Agent Vanzari 1" }
  },
  {
    "id": "org_mock_002",
    "externalId": "mock-1002",
    "organizationNo": "ACC90002",
    "name": "Demo Instal Nord SA",
    "legalForm": "SA",
    "cui": "99000002",
    "vatPayer": true,
    "tradeRegisterNo": "J99/0002/2015",
    "organizationType": "Client potential",
    "rating": "Insolventa",
    "customerCategory": "Normal",
    "industry": "Industrie Mecanica - Piese, Confectii metalice",
    "industrySpec": null,
    "caenCode": "2562 Operatiuni de mecanica generala",
    "phone": "0700 000 002",
    "otherPhone": "0700 000 012",
    "mobilePhone": null,
    "fax": "0700 000 022",
    "email": "contact@demo-instal.test",
    "website": "https://demo-instal.test",
    "emailOptOut": true,
    "employees": 180,
    "annualRevenue": 4200000,
    "assignedTo": { "type": "group", "id": "g_mock_02", "name": "Echipa Vanzari" },
    "billingStreet": "Bd. Demonstratiei nr. 5",
    "billingCity": "Baia Mare",
    "billingState": "Maramures",
    "billingCode": "430000",
    "billingCountry": "Romania",
    "description": null,
    "createdAt": "2012-06-20T07:30:00Z",
    "modifiedAt": "2024-02-10T10:05:00Z",
    "modifiedBy": { "id": "u_mock_03", "name": "Agent Vanzari 2" }
  },
  {
    "id": "org_mock_003",
    "externalId": "mock-1003",
    "organizationNo": "ACC90003",
    "name": "Proba Agro Vest II",
    "legalForm": "II",
    "cui": "99000003",
    "vatPayer": false,
    "tradeRegisterNo": "F99/0003/2019",
    "organizationType": "Client ocazional",
    "rating": "Activ",
    "customerCategory": "Silver",
    "industry": "Agricultura - Legumicultura, Sere",
    "industrySpec": "Sere legume",
    "caenCode": "0113 Cultivarea legumelor",
    "phone": null,
    "otherPhone": null,
    "mobilePhone": "0700000103",
    "fax": null,
    "email": null,
    "website": null,
    "emailOptOut": false,
    "employees": 3,
    "annualRevenue": null,
    "assignedTo": { "type": "user", "id": "u_mock_11", "name": "Agent Vanzari 3" },
    "billingStreet": "Sat Exemplu nr. 7",
    "billingCity": "Lugoj",
    "billingState": "Timis",
    "billingCode": null,
    "billingCountry": "Romania",
    "description": "Interesat de motopompe pentru irigatii.",
    "createdAt": "2023-05-08T12:00:00Z",
    "modifiedAt": "2023-05-08T12:00:00Z",
    "modifiedBy": { "id": "u_mock_11", "name": "Agent Vanzari 3" }
  }
]
```

---

## 7. What is NOT worth copying

The vtiger fields and features left out of the rebuild, with the reason and the data behind it. Leaving them out keeps the new UI simpler.

Rule (Bogdan, 2026-10-17): a field filled on fewer than 15% of the organizations is not ported;
a client who needs one adds it as a custom field. Every field marked dropped in §5.2 is below.

| Element [vtiger 5.4] | Reason | Data |
|---|---|---|
| Ticker Symbol | Romanian companies, not listed | 0% filled |
| Notify Owner | never used; notifications are done differently | 0% checked |
| Ownership | free text with people's names (personal data), almost empty; hidden in the UI (detail, form, list; 2026-10-17), removal from the cube requested (organizations-backend.md §1); the record owner is the kernel's | 0,5% (316 org.) |
| Member Of + "Show Organization Hierarchy" | hierarchy almost unused; a separate page for 12 rows | 12 org. with a parent, 11 parents |
| PO Box (billing/shipping) | unused in RO | 2,4% / 0,03% |
| Other Industry + Other Industry Spec | duplicate Industry / Industry Spec | 1,5% / 1,2% |
| Other Fax | almost empty | 1,2% |
| Bank + IBAN | under 15% | 6,1% / 5,0% |
| Product Category | under 15% | 4,1% |
| Other Email | under 15% | 6,1% |
| Account Turnover (€) | under 15%; Annual Revenue covers the amount | 8,9% |
| Shipping address (street, city, state, postal code, country) + the address copy | under 15%; the country is only the "Romania" default, the state free text | street 7,9%, country 50,8% (default), 48 distinct states |
| Tag cloud ("Tag it") | unused | 6 tags on 4 organizations |
| Mail Merge with Word templates | old Office technology; replaced by PDF/EMAIL Maker | 2 templates |
| Mini calendar, world clock, calculator, chat in the toolbar | gadgets unrelated to the module | – |
| Announcement marquee | outdated UX; a dismissible banner is enough | – |
| Filter approval workflow (pending) | 59 filters left pending; no value | 148 private, 59 pending, 54 public |
| Dozens of nearly identical filters | can be replaced by filter chips + saved views | 262 filters, series of 20+ clones |
| The "Custom Information" block | empty (the custom fields live in block 1) | 0 fields |
| Empty related lists | HelpDesk 0, Services 0, Assets 0, Service Contracts 1, Products 2, Invoice 8 | hidden until there is data |
| Mailer Export | special email export; covered by Export + the Email Opt Out filter | – |
| `cf_716` Cod import | hidden (presence 1), import artifact | 13,1% |
| The "Organization Name Already Exists!" message on a duplicate CUI | wrong text (overridden language key) | – |

---

## 8. What the backend needs (WHAT, not HOW)

The base list of backend work the UI depends on. organizations-backend.md details it step by step.

- [ ] Every kept field of §5.2 in the cube (read + write), with the proposed names; not the rows marked dropped.
- [ ] Picklists P1–P5 and P7 exposed as metadata (values + order); optionally filtered by role, as in 5.4.
- [ ] Assigned To: user or group, list of active users and groups; "mine" filter.
- [ ] Created/Modified At + Modified By, read-only.
- [ ] Delete (single), with confirmation; optionally a recycle bin/restore.
- [ ] Mass delete on the selection and on "all the filter's results".
- [ ] Mass edit on the selection/filter (any editable field, including changing the owner).
- [ ] CSV export: current filter / page / selection.
- [ ] CSV import with field mapping and a duplicate rule (on CUI).
- [ ] Server-side CUI validation: unique + check digit; message naming the existing organization.
- [ ] Email and length validation (the same rules in the form and in inline edit).
- [ ] Text search on name, CUI, email, phone (partial, not exact).
- [ ] Filters with operators (equals, contains, starts/ends with, not, <, >, ≤, ≥, between, before/after, empty) on any field, AND/OR groups.
- [ ] Relative date filters (today, last 7/30 days, current month etc.) on Created/Modified.
- [ ] Saved views (name, columns, sorting, conditions), personal or shared, one default.
- [ ] Sorting on any displayed column (not only name/industry/createdAt).
- [ ] Record total in the list response; configurable page size.
- [ ] Billing State; optionally propagating the billing address to contacts.
- [ ] Custom fields placed by module and group (organizations-backend.md §10).
- [ ] Duplicate detection and merging (identical CUI: 499 CUIs appear more than once; identical name: 896).
- [ ] Comments on the organization (timeline).
- [ ] Sending email to the organization + email history.
- [ ] Prev/next within the current list (optional).
- [ ] Related modules that do not exist yet in crm-pack: Opportunities (Potentials), Quotes, Sales Orders, Invoices, Activities/Calendar (Events, To Do, Activity History), Emails, Documents, Tickets (HelpDesk), Products, Campaigns (+ status on the relation), Services, Service Contracts, Assets, Projects, PVS Intrări, Devize, PVS Ieșiri.
- [ ] SELECT relations (link/unlink existing records) for Documents, Products, Campaigns, Services, Projects.
- [ ] Permissions per action (create/edit/delete/export/import) and visibility by owner/role.
