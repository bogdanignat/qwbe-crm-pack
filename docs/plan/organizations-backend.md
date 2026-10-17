# Organizations: what the backend needs for the mock to disappear

The backend work the Organizations UI waits for, step by step. Until it is done the UI shows made-up fields and records, marked and read-only; once it is done that mock layer can be deleted.

Epic T-1809. This document says WHAT is needed, not HOW. Each UI step completes it.
Full specification: `organizations-ui-spec.md` (§5 fields, §8 the base list).

The frontend mockup layer: `frontend/src/mock/organizations/`
(`fields.json`, `picklists.json`, `organizations.json`, `index.ts`).
A mock field disappears on its own as soon as `GET /catalog/crm%2Forganizations/metadata`
publishes a field with the same name; the frontend does not change.

## 1. Fields missing from the cube (step 1, T-1811)

The 15 vtiger fields the organizations cube does not have yet. Without them the detail page and the list show mock values instead of real data.

All 15 go into the cube, with the names below, readable and writable (except the read-only ones).
Type, required flag, length and picklist are the vtiger ones (§5.2); the exact source
is `frontend/src/mock/organizations/fields.json`. The 15 fields and the picklists P1, P2,
P3, P5 and P7 were checked against the vtiger database; P4 is the complete list from it
(vtiger order, normalized, without "--None--").

**Dropped** (Bogdan's decision, 2026-10-17): the vtiger fields filled on fewer than 15% of the
61,347 organizations (fill rates in spec §5.2) are not ported and the UI does not show them:
Other Industry, Other Industry Spec, Product Category, Bank, IBAN, Other Fax, Other Email,
Account Turnover (€), Ticker Symbol, Notify Owner, Member Of, the two PO Boxes and the whole
shipping address (street, city, state, postal code, country). Their picklists P6, P8 and P9 go
with them. A client who needs one adds it as a custom field (§10).

**Ownership is hidden in the UI** (frontend decision, 2026-10-17): the detail, the form and the
list never show `ownership`, although the cube still publishes it.
**Request for the backend:** remove `ownership` from the crm/organizations cube, together with
its vtiger mapping (`mappings/accounts.json`) and export column (`a.ownership`). It is 0,5%
filled with free text holding people's names; it is not refilled with the creator, because the
record owner is the kernel's. Stored rows may keep the key in their body; reads and writes must
still pass with it.

| Name | Label (en_us) | Type | Req. | Length | Picklist | Notes |
|---|---|---|---|---|---|---|
| modifiedAt | Modified Time | datetime | – | – | – | read-only |
| legalForm | Form | picklist | yes | 255 | P1 | |
| vatPayer | TVA | boolean | yes (formal) | – | – | |
| cui | CUI | text (digits) | yes | 20 | – | unique + check digit |
| tradeRegisterNo | Reg no | text | no | 20 | – | |
| customerCategory | Category | picklist | no | 255 | P7 | |
| assignedTo | Assigned To | user or group | yes | – | – | `{type, id, name}` |
| otherPhone | Other Phone | phone | no | 30 | – | |
| mobilePhone | Comp Mobile Phone | phone | no | 15 | – | |
| annualRevenue | Annual Revenue | integer (EUR) | no | – | – | UI label "Annual Revenue (EUR)" |
| fax | Fax | phone | no | 30 | – | |
| caenCode | SIC Code | text | no | 50 | – | "NNNN Description" |
| industrySpec | Industry Spec | text | no | 50 | – | |
| modifiedBy | Last Modified By | user | – | – | – | read-only, `{id, name}` |
| billingState | Billing State | picklist | yes | 30 | P2 | |

### Import and data notes

Points to settle when vtiger's data is imported into the new fields. They keep the import from losing or inventing data.

- [ ] The dropped fields (§1) have no place in the cube. Open: whether their vtiger values are
      imported into a custom field for a client who defines one (§10), or left behind.
- [ ] **Currency:** a single currency for every amount, configured at qwbe level 0. EUR for now;
      the UI labels say "(EUR)" until the backend publishes the configured currency.

## 2. Metadata

What the cube's metadata must publish so the UI can build itself from it. Today the frontend fills these gaps by hand, and each hand-made piece can drift from the backend.

- [ ] Picklists as `enum` in the metadata, with the vtiger values and order: P1, P2 and
      P7 on the new fields; P3 on `organizationType`, P4 on `industry`, P5 on `rating`
      (all three are `enum: null` today). Optionally filtered by role, as in 5.4.
- [ ] A display format for text fields: `email`, `phone`, `url`. Today the metadata publishes
      `phone`, `email` and `website` as plain `type: "string"`, with no format, so the UI
      supplies one to show them as tel:/mailto:/http links, as vtiger does: for the real
      fields in `frontend/src/lib/organization-display.ts`, for the mock ones in
      `fields.json` (otherPhone, mobilePhone, fax: phone). A format the
      backend publishes wins over the UI's.
- [ ] The vtiger en_us labels on the existing fields, where they differ: Type (today
      "Organization Type"), Billing Address ("Billing Street"), Billing Postal Code
      ("Billing Code"), Created Time ("Created At"), Organization Name ("Name"). Until then
      the UI supplies them (`ORGANIZATION_LABELS` in `lib/organization-display.ts`); a label
      the backend publishes the same way makes that entry redundant. `rating` is shown as "Company status" (in vtiger it is the company's legal status);
      that one is a UI decision and stays in the frontend (`lib/organization-display.ts`).
- [ ] The maximum length of every text field, so the UI can validate before saving.
- [ ] A published type for the user/group references (`assignedTo`, `modifiedBy`); the UI
      shows `name`.
- [ ] `modifiedAt`, `modifiedBy`, `createdAt` read-only (`editable: false`).
- [ ] The group (block) and position of every field, custom or not (§10).

## 3. List (step 4, T-1813)

What the Organizations list needs from the backend to work like vtiger's. Until then the controls stay hidden or disabled, so the list never promises what it cannot do.

The list follows vtiger 5.4 (spec §2.6). What it cannot do yet:

- [ ] **Sorting on every displayed column.** The contract sorts on `name`, `industry` and
      `createdAt` only, so Organization No, CUI, Billing City/State, Website, Phone and
      Assigned To have no sort button. Default sort Modified Time descending, as in vtiger
      (needs `modifiedAt`, §8).
- [ ] **Quick search on name, CUI, email and phone**, matching as in §11. `q` scans `name`,
      `industry` and `externalId` today; CUI is not published yet (§1); email and phone are not
      search fields.
- [ ] **A-Z letter bar** (Organization Name *starts with* a letter): needs a prefix filter on the
      name alone; `q` would also match the industry. Not built.
- [ ] **Filters** at least on billingState, legalForm, rating, assignedTo, and filters with
      operators (greater than, ...) for the vtiger filter conditions (spec §2.3); text filters match
      as in §11. Today: `name`, `industry`, `externalId`, behind "Filters" with a chip each.
- [ ] **Mass actions** on the selection, shown disabled ("Needs backend") in the selection bar:
      Delete (with confirmation), Mass Edit (the `masseditable` fields, an "apply" tick per
      field), Send Mail (to the Email, compose, keep the history), Mailer Export
      (organization and contact emails, opt-out rules), Send SMS (an SMS provider).
- [ ] **Selection over the whole result** ("Select all N records"): the mass endpoints must accept
      the current filter, not only ids. Today the selection is the page in view.
- [ ] **Single delete** from the row menu (shown disabled, "Needs backend").
- [ ] Total in the list response (exists) and page sizes 25/50/100 (all within `maxPageSize`).
- [ ] Export / Import / Find Duplicates of the vtiger toolbar (spec §2.2): not built.

## 4. The rest of §8 (the next steps detail it)

The remaining items of the spec's base list, not yet tied to a UI step. They are kept here so none is forgotten.

- [ ] Assigned To: list of active users and groups; "mine" filter.
- [ ] Single delete with confirmation; optionally a recycle bin.
- [ ] Mass delete and mass edit on the selection and on the whole filter result.
- [ ] CSV export (current filter / page / selection); CSV import with duplicates on CUI.
- [ ] Server-side CUI validation (§9, §12); email and length validation, the same in the form
      and inline edit.
- [ ] Filters with operators and AND/OR groups; relative date filters; saved views.
- [ ] Optionally propagating the billing address to the organization's contacts.
- [ ] Duplicate detection and merging (CUI, name).
- [ ] Comments, email to the organization and its history, prev/next in the list (optional).
- [ ] The missing related modules (§3.5) and the SELECT relations (link/unlink).
- [ ] Permissions per action and visibility by owner/role.

## 5. What disappears from the frontend when the backend is ready

What each backend piece removes from the frontend on its own, without a code change. It shows which work brings real data to the pages fastest.

- A field of §1 published under the same name: its mock disappears automatically.
- Picklists published as `enum`: `picklists.json` is no longer needed.
- The group and position of every field published (§10): `src/lib/organization-layout.ts`
  and the "Custom fields" block are no longer needed.
- The demo organizations (`organizations.json`, `org_mock_001..003`) need nothing from
  the backend; they go once the real organizations carry the new data.
- The `rating` label stays: it is a UI decision, not part of the mock.
- `ownership` removed from the cube (§1): `"ownership"` leaves `ORGANIZATION_HIDDEN`
  (`organization-layout.ts`) and `ORGANIZATION_LIST_UNLISTED` (`organization-list.ts`).

## 6. Retiring the mock layer

The exact list of frontend code to delete once the backend has everything. Kept current with each step, so the cleanup is mechanical and nothing mock is left behind.

A mechanical deletion, all under `frontend/`. Nothing outside this list refers to the mock.

1. Delete `src/mock/` (fields, picklists, demo records and demo contacts, `withMockFields`,
   its tests).
   `VTIGER_PLACEMENT` and `PICKLISTS` are used by the detail and form steps: move what
   they still need first, or retire them with the steps that use them.
2. Delete `src/components/mock-tag.tsx`.
3. `src/lib/qwbe-data-provider.ts`: the `demoOrganizationOf` import, the demo branch in
   `getOne` and the demo refusal in `update`.
4. The list (T-1813): `src/hooks/use-list-query.ts` (the `withMockFields` import and call),
   `src/components/cube-list.tsx` (the `demoRows` prop, `demoRowsMatching`, and `empty` becomes
   `page.rows.length === 0`), `src/components/list/list-table.tsx` (the demo rows, their
   disabled checkbox and the `MockTag`; the `FieldMarker` in the headers),
   `src/components/list/demo-row-checkbox.tsx`, `listWindowOf`'s demo rows and its demo counts
   in `src/lib/cube.ts`,
   `src/components/organizations/organization-list.tsx` (`DEMO_ORGANIZATIONS`, the demo branch of
   the row menu) and `src/lib/demo-search.ts` with its test (keep `matchesPrefix` if the palette
   still needs it).
5. `src/hooks/use-cube-metadata.ts`: the `withMockFields` import and call.
   `src/components/kit/cube-show.tsx`: the `MockTag` import and call, and the `demo` prop with
   its three uses (editable fields, pencil, title tag).
   `src/components/organizations/`: the `MockTag` use in organization-header, the
   `FieldMarker` uses (organization-info, contacts-table, and `form-field-label.tsx`,
   `list/column-picker.tsx` outside it) with `src/lib/field-marker.ts` and
   `src/components/field-marker.tsx`, and the `demo` prop (organization-detail,
   organization-header, related-contacts, with the `demoContactsOf` slice there).
   `src/hooks/use-duplicate-values.ts`: the `demoOrganizationOf` guard. The read-only previews
   `src/components/sharing-preview.tsx` and `activity-preview.tsx` go with their `demo`
   branches. `src/lib/organization-layout.ts` keeps the vtiger rows until the metadata places
   the fields (§10); a test there reads `VTIGER_PLACEMENT` and goes with the mock.
6. `src/components/cube-create-form.tsx`: the `withMockFields` import and call.
7. `src/app/organizations/[id]/page.tsx`: the `demoOrganizationOf` import and the `demo` flag.
8. `src/lib/organization-display.ts`: the `picklists.json` import and `ORGANIZATION_ENUMS`
   (with their test), once the backend publishes the three enums (§9).
9. `src/lib/cube.ts`: `mock?` in `FieldMetadata`, `&& !field.mock` in `canEdit`, the mock
   refusal in `saveCell`, the mock skip in `createPayloadOf`, and the `demoRows` parameter of
   `listWindowOf` (with the "+N demo" part of its label).
10. `src/lib/kit-form.ts`: the mock skip in `updatePayloadOf`.
11. `src/lib/global-search.ts`: the `DEMO_ORGANIZATIONS` and `ORGANIZATIONS_CUBE` imports,
    `DEMO_ROWS`, `DEMO_EXTRA_SEARCH`, and `demoRows` (in `SearchModule`, `SEARCH_MODULES` and
    `searchModule`).

What stays: `withOrganizationDisplay` (`src/lib/organization-display.ts`: the `rating` label
and the link formats), `format?` in `FieldMetadata` with `formatHrefOf` and
`src/components/format-link.tsx` (until the backend publishes formats, then they read its
value), and `valueTextOf` (reference objects such as `assignedTo`).

## 7. Main menu (step 2, T-1812)

What the app shell (menu, global search, "+ New") needs from the backend. Without it some modules and searches are missing or limited.

The shell (sidebar, ⌘K search, "+ New", account menu; spec §1.5) works on what exists today.
What it cannot do without the backend:

- [ ] **Global search over every module**: one search that answers, per searchable module,
      its matching records and their count. Today the palette sends one `q` list request per
      module it knows (organizations, contacts) and sees nothing else.
- [ ] **Partial search**: the palette matches as in §11, the same rule in every module.
- [ ] **Why a record matched**: the field that matched, or a short subtitle (city, CUI, a
      contact's organization), so two hits with the same name can be told apart.
- [ ] **The user's display name** in `/auth/me` (first and last name); today only `username`,
      which is what the account menu shows.
- [ ] **Global search across several fields with a module filter**: one search over at
      least name, CUI, email and phone (matching as in §11), with a filter on the module
      (Organizations, Contacts, ...). Today the demo organizations are found by CUI, email and
      phone in the palette (they are local), the real ones by `q` only.
- [ ] Optional: a capability in `/auth/me` saying whether the user may open Settings. Today the
      menu shows Settings and Echo when `roles` contains `admin` (the test the activity feed
      uses); the Settings page and the backend still check `customfields:write` themselves.
- [ ] **Notifications** (🔔 in §1.5): a per-user notification source. No bell until it exists.
- [ ] **Favorites** (★ in §1.5): per-user storage of pinned records or views.

**Modules missing from the menu.** A module appears once it has a cube with metadata and a list
contract (its `q` search fields); the frontend then adds its page and one entry in
`frontend/src/lib/app-pages.ts`, from which the menu, "+ New", the search and the record links
derive. Grouped as in vtiger 5.4 (§1.3); RSS, Portal, FAQ and Webmails are
dropped (§1.5).

| Group | Modules without a page |
|---|---|
| Sales | Opportunities (Potentials), Leads, Quotes, Sales Order, Invoice |
| Support | Tickets (HelpDesk), Service Contracts, Devize, PVS Intrări, PVS Ieșiri, Assets, Projects, Project Milestones, Project Tasks |
| Marketing | Campaigns |
| Inventory | Products, Services, Vendors, Price Books, Purchase Order |
| Analytics | Reports, Dashboards |
| Tools | Documents, Calendar, Emails / Mail Manager, Comments, Recycle Bin, PDF Maker, EMAIL Maker, SMS Notifier, PBX Manager, Integration |

`crm/contracts` is already a cube but has no page: that one is frontend work, not backend.
In the menu today: Sales → Organizations, Contacts; Settings and Echo (the activity feed, a
developer page) under Administration at the bottom, for admins only; Preferences (`/me`) in
the account menu.

## 8. Detail view (step 3, T-1814)

What the organization's detail page needs from the backend. Until then those actions are disabled, with the reason shown.

The detail page follows vtiger 5.4 (spec §3.6): header, the "Organization Information" and
"More Information" tabs, the Actions box. What it cannot do without the backend:

- [ ] **Delete** (single, with confirmation; optionally a recycle bin and restore). The button is
      shown disabled ("Needs backend"); the data provider refuses `delete` today.
- [ ] **Previous / next across pages and "jump"**: the arrows (T-1813) walk the list page the
      record was opened from, kept in the tab's sessionStorage; at the page's ends they stop.
      Crossing pages, and vtiger's record dropdown, need the neighbours of a record under the
      list's filter and sort (or a cursor).
- [ ] **Modification time and author** published on every organization (`modifiedAt`,
      `modifiedBy`), so the header says "Updated <when> by <who>" for real records; today it falls
      back to "Created <when>".
- [ ] **Timestamps typed as such** in the metadata (`createdAt`, `modifiedAt` as `datetime`); the UI
      recognizes them by their ISO value today.
- [ ] **Contacts:** the vtiger columns the contacts cube does not publish: `lastName`,
      `firstName`, `mobilePhone`, `title`, `assignedTo` (shown marked MOCK and empty; one "Name"
      column stands in for Last/First Name). The related list sorts by `lastName` once the cube
      publishes it as sortable (vtiger's order); until then by `name`, which starts with the first
      name. The row's **del** is disabled until contacts can be deleted; **edit** opens the
      contact's page in edit mode.
- [ ] **The other 18 related lists of spec §3.5**, each needing its module (cube with metadata and
      a list filter on the organization): Opportunities (Potentials), Quotes, Sales Order, Invoice,
      Activities (Events, To Do), Emails, Activity History, Documents, Trouble Tickets (HelpDesk),
      Products, Campaigns (+ status on the relation), Services, Service Contracts, Assets, Projects,
      Procesverbalin (PVS Intrări), Devize, Procesverbalout (PVS Ieșiri). Not shown in the UI.
      Each needs a record count per organization, its own paging, ADD with the organization
      preset, and for the SELECT lists (Documents, Products, Campaigns, Services, Projects)
      link/unlink of existing records.
- [ ] **Quick actions** of the sidebar, shown disabled ("Needs backend"):
  - Add Event and Add To Do: a Calendar module (events, tasks) linked to the organization.
  - Add Note: Documents linked to the organization (upload or note).
  - Send SMS: an SMS provider and the SMS Notifier history.
  - Show Organization Hierarchy is left out: Member Of was dropped (§1), so there is no tree.
- [ ] **Send Mail** works as a `mailto:` to the organization's email. vtiger's version (choose the
      address, send from the CRM, keep the email in the history) needs an email module.
- [ ] **Mail Merge** (Word templates, 2 for Organizations) and **EMAILMaker** (22 email templates):
      not built. Mail Merge is not worth copying (spec §7); EMAILMaker needs templates and sending
      on the server.
- [ ] **Locate Map** (Address Information, Google Maps on the billing address): not
      built; a plain map link needs nothing from the backend, a stored geocode would.
- [ ] **Inline edit validation:** the frontend runs the same generic metadata check in the
      form and inline (required, `maxLength`, email format, whole numbers); every business rule
      (CUI, uniqueness) is the backend's refusal, the same on PATCH as on create (§9).
- [ ] **Duplicate** (T-1815) copies every editable field the backend publishes, except
      `externalId` and Organization No. A full prefilled copy needs every field of §1 in the cube.

## 9. Create / edit form (step 5, T-1815)

What the organization form (create, Duplicate, Edit all; spec §4.5) needs from the backend. Business and format validation belongs to the backend: it must refuse the mistakes below for the form, inline edit, import and any API client.

**What the frontend checks (T-1832).** Only the generic check every cube form shares (`lib/validators.ts`, `fieldError`), driven by the published metadata: `required`, `maxLength`, `format: "email"` and whole numbers on `type: "integer"`, the same in the full form and in inline edit. It no longer checks the CUI (check digit, digits only, the "RO" prefix), uniqueness, the IBAN, or hand-written lengths and required lists: it relies on the backend's refusal (a 422 with per-field `issues`, shown under each field) and on `required` / `maxLength` / `format` in the metadata. **Until the backend enforces a rule below or publishes it in the metadata, an invalid value can be saved.**

### Validations the backend must enforce

The rules vtiger applies. Each needs a check and a per-field message on create and update; the generic ones (required, lengths, email) also need publishing in the metadata, so the form checks them before sending.

- [ ] **Required:** Organization Name, Form, TVA, CUI, Assigned To, Industry, Billing State
      (vtiger `~M`). Publish them as `required` in the metadata; today only `name` is, so the
      form marks and requires only Organization Name (the mock fields show the flag of the
      mock metadata, read-only). Industry is required by vtiger but optional in the cube:
      decide which wins. TVA is a boolean: "required" means "never null", not "true".
- [ ] **CUI:** a valid CUI as the company validation pack defines it (§12: format, the "RO"
      prefix, check digit, existence), and **unique** among non-deleted organizations, as a
      per-field issue on `cui`. The refusal should name the existing organization (id and
      name).
- [ ] **Email:** a valid address. Publish `format: "email"` for it (the frontend attaches it
      today in `organization-display.ts`), and refuse an invalid one.
- [ ] **Lengths:** publish `maxLength` per string field in the metadata (the form already reads it)
      and refuse longer values: vtiger's declared ones are CUI 20, Reg no 20, Industry Spec 50,
      Comp Mobile Phone 15. Until then the form checks no length.
- [ ] **Whole numbers:** Employees, Annual Revenue.

- [ ] **Picklists:** publish `enum` for `organizationType` (P3), `industry` (P4) and `rating` (P5),
      and refuse a value outside it on create and update. The frontend attaches vtiger's values
      today (`ORGANIZATION_ENUMS` in `organization-display.ts`); a published enum wins. Decide what
      happens to the stored values outside the list (legacy Industry values): the UI keeps them
      visible and selectable, so a migration or an "other" mapping is needed before the backend
      refuses them.

### Other needs found

What else the form relies on or works around. None blocks the form; each removes a stand-in.

- [ ] **Refusals per field:** a 422 with `issues` (path + message) per field. The frontend
      already shows each message under its field, in the form and in the inline editor; a
      refusal without a usable path stays the general message above the form.
- [ ] **Organization No** generated on create (vtiger `ACC<n>`) and read-only; today it is a
      plain editable string, so the form edits it, and Duplicate leaves it empty.
- [ ] **Assigned To** as a relation to users and groups (vtiger's User / Group choice); the form
      shows it disabled until then, and takes the existing user picker once it is published.
- [ ] **Fill from ANAF** and the CUI checks against the register: the company validation
      pack, §12 (the form's part is listed there).

## 10. Custom fields: module and group

How a custom field gets its place on the page. Today a runtime custom field the layout does not name lands in a catch-all "Custom fields" block; with a group per field, every field sits where it belongs and the hand-written layout can go.

### Choosing where a field goes

- [ ] **Two choices, in order:** creating a custom field asks first for the **module** (the
      `targetCube`: Organizations, Contacts, ...) and then for the **group** (block) of that
      module. For Organizations the groups are Organization Information, Address Information and
      Description Information.
- [ ] **The group list depends on the module:** another module offers its own groups; changing
      the module empties the group choice.
- [ ] **No group, no field:** a definition without a group is not saved. There is no catch-all
      "Custom fields" block any more.

### Backend

- [ ] **Groups in the metadata:** each module publishes its groups, each with a `key`, a `label`
      and an `order`.
- [ ] **`block` on the definition:** required; refused when it is not a group of that module.
      Editable later, so a field can move to another group.
- [ ] **`sequence` on the definition:** optional, the position inside the group (the definition's
      `position` today has no group to count in). Editable later.
- [ ] **Every field placed:** the cube metadata publishes every field, custom or not, with its
      `block` and `sequence`, so the frontend places fields from the metadata instead of a
      hand-written layout.
- [ ] Optional: a **"shown in the list by default"** flag on the definition (today the list's
      hidden custom fields are a per-browser preference, `src/lib/field-prefs.ts`).

### Frontend, once published

- The Settings form asks for the Module, then the Group of that module.
- The detail page and the form place each field in its group, in `sequence` order.
- The hand-written placement in `src/lib/organization-layout.ts` and the "Custom fields" block
  (`CUSTOM_BLOCK_TITLE` in `src/lib/field-blocks.ts`) can go.

## 11. Search and filters: match like a normal search

The one matching rule for every search box and text filter, in the lists and in ⌘K. Today a user who types one word of a company name, or a piece of an id, finds nothing and concludes the record does not exist.

- [ ] **A piece of the value finds the record:** the text matches anywhere inside the value
      (contains), at least at the start of any word. "ONE" finds "HINT ONE ZERO", "srl" finds
      "Acme SRL", "1815" finds "T-1815 E2E Test SRL".
- [ ] **From 3 characters:** a search starts at 3 characters; under 3 the frontend sends
      nothing (it waits). Decide what the backend does with a shorter `q` (ignore it or refuse
      it), and whether an exact value shorter than 3 (a 2-digit CUI) is still found. The A-Z bar
      (§3) is a separate name-prefix filter, not `q`.
- [ ] **Case and diacritics do not matter:** "brasov" finds "Brașov", "hint one" finds
      "HINT ONE ZERO", both ways (a query with diacritics finds the value without them).
- [ ] **Every searchable field and every text filter, the same rule:** name, CUI, email, phone,
      city, Organization No, `externalId` and the other ids. A filter on a picklist or a
      reference chosen from its list (billingState, legalForm, rating, assignedTo) stays an exact
      value.
- [ ] **An unknown filter is refused** (a 400 naming the parameter), not ignored: today it is
      dropped silently and the answer is the whole list, which looks like a match.
- [ ] **Global search (⌘K)** uses the same rule in every module it searches (§7).
- [ ] **Best matches first:** an exact match, then a match at the start of the value, then at
      the start of a word, then inside a word; so a full CUI or a full name still comes first.
      The list's chosen sort applies within each group, or replaces this order when the user
      sorts by a column (decide).
- [ ] **Fast on real data:** a search or filter answers quickly on 61k+ organizations (and on
      the larger modules), as fast as the prefix search does today.

**Today** (dev qwbe, 2026-10-17, 4 organizations, 4 contacts; requests sent to qwbe directly,
`http://localhost:4500`, and two of them repeated through the frontend proxy
`/api/qwbe/...` with the same result):

- Today: `GET /catalog/crm%2Forganizations/metadata` publishes `list.search` = `name`,
  `industry`, `externalId` and `list.filters` = `externalId`, `industry`, `name`. Contacts:
  search `name`, `email`, `externalId`; filters `email`, `externalId`, `name`, `organizationId`.
- Today: `q` is a case-insensitive prefix of the whole value. `GET /organizations?q=hint`,
  `?q=HINT` and `?q=hint%20one` find "HINT ONE ZERO"; `?q=ONE`, `?q=one` and `?q=ZERO` find
  nothing. `?q=srl` and `?q=SRL` find nothing ("Acme SRL"); `?q=acme` finds it. `?q=E2E` and
  `?q=1815` find nothing, `?q=T-1815` finds "T-1815 E2E Test SRL".
- Today: diacritics are not folded. `?q=test` finds 2 ("TEST" by name, "T-1815 E2E Test SRL"
  by its industry "Testing"); `?q=țest`, `?q=ȚEST` and `?q=tést` find nothing.
- Today: no minimum length. `?q=a` finds "Acme SRL"; `?q=%20` (one space) returns all 4.
- Today: the filters are exact and case-sensitive. `?name=HINT%20ONE%20ZERO` finds it;
  `?name=hint%20one%20zero`, `?name=HINT`, `?name=ONE` and `?name=Acme` find nothing.
  `?industry=IT` finds 2, `?industry=it` none; `?industry=Testing` finds 1, `?industry=Test`
  and `?industry=esting` none.
- Today: `?externalId=123` finds nothing. No dev organization has an `externalId` or an
  Organization No, so a partial id could not be tried on data.
- Today: unknown filters are ignored. `?organizationNo=ACC`, `?cui=123`,
  `?email=hintstudio` and `?billingCity=Iasi` all answer 200 with all 4 organizations.
- Today: no relevance order. `?q=t` answers `sortedBy: "createdAt"` ("TEST", then
  "T-1815 E2E Test SRL").
- Today: contacts behave the same. `GET /contacts?q=dan` finds "Dan Popescu";
  `?q=popescu` finds nothing, `?q=acme` finds nothing (emails at acme.ro).

Frontend, once done: the placeholders "Name or industry starts with…" (organizations),
"Name or email starts with…" (contacts) and the palette's "whose name starts with" change to
the new rule; the list and the palette wait for 3 characters.

## 12. Company validation: a separate qwbe pack

A qwbe pack of its own, not inside crm-pack, that checks Romanian companies by CUI and returns their official data. Organizations and any other module with a CUI (contacts, vendors, invoices) use it, so the rule and the source are written once.

### What the pack answers

- [ ] **CUI format:** digits only, 2 to 10 digits. The "RO" prefix: accepted on input and
      stored without it, or refused as this plan said until now (§9): decide. Spaces around it
      are trimmed.
- [ ] **Check digit** with the key 753217532; a wrong one is refused without asking the source.
- [ ] **The company exists:** the source knows the CUI. Decide whether an unknown CUI is a
      refusal or a warning (a company registered today may not be in the source yet).
- [ ] **The name matches the CUI:** a given name is compared with the official one, tolerant to
      case, diacritics, spacing and punctuation, and to the legal form suffix ("SRL", "S.R.L.",
      "SA", ...). The answer is match, no match, or could not verify.
- [ ] **Company data for prefill:** name; address (street, city, county, postal code); Trade
      Register no.; CAEN code; VAT payer status; inactive status; registration in the
      e-Factura register; and when the data was checked.
- [ ] **Validation on save:** the checks above are usable by a module's create and update, so
      the backend refuses an invalid CUI for every client (form, inline edit, import, API);
      Organizations uses them on `cui` (§9).
- [ ] **Several CUIs at once**, for imports and bulk checks (61k organizations), within the
      source's limits below.
- [ ] **Access:** only authenticated users with a permission of the pack; it is not an open
      proxy to the source.

### Source

- [ ] **Start with ANAF's public web service:** free, no account or key:
      `POST https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva`. Usage limit about 1
      request per second and up to 100 CUIs per request: both to confirm in ANAF's instruction
      files.
- [ ] **Alternatives to evaluate later:** openapi.ro (free tier not confirmed), demoanaf.ro
      (unofficial, 300 requests/minute, no key), termene.ro (paid, a few free queries per year).
- [ ] **Replaceable source:** changing or adding a source does not change the callers or the
      answers they get.

### Availability and limits

- [ ] **Answers are cached:** a company does not change every minute, so a recent answer is
      reused instead of asking the source again (how long: decide).
- [ ] **The source's rate limit is respected** for all callers together; a burst (an import)
      waits its turn, it never exceeds the limit.
- [ ] **An unavailable source never blocks saving:** when the source does not answer (down,
      slow, over its limit), the existence and name checks answer "could not verify", not a
      refusal, and the organization is saved. Format and check digit do not depend on the
      source and still refuse.

### What belongs to crm-pack

Only the frontend action and the form behaviour; everything above is the pack.

- [ ] **"Fill from ANAF"** on the organization form (create, Duplicate, Edit all): from the
      CUI, it fills the name, the billing address (street, city, Billing State from the county,
      postal code), Reg no, SIC Code (CAEN) and TVA. It saves nothing; the user reviews and saves.
- [ ] **The form shows the pack's answer:** inactive company, not in the e-Factura register,
      name that does not match, or "could not verify" (saving stays possible).
