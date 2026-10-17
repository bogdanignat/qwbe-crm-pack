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
| vatPayer | TVA | boolean | yes (formal) | – | – | explicit, never from the "RO" prefix (§12 formats) |
| cui | CUI | text (digits) | yes | 20 | – | unique + check digit; stored without "RO" (§12 formats) |
| tradeRegisterNo | Reg no | text | no | 20 | – | format: §12 formats |
| customerCategory | Category | picklist | no | 255 | P7 | |
| assignedTo | Assigned To | user or group | yes | – | – | `{type, id, name}` |
| otherPhone | Other Phone | phone | no | 30 | – | |
| mobilePhone | Comp Mobile Phone | phone | no | 15 | – | |
| annualRevenue | Annual Revenue | integer (EUR) | no | – | – | UI label "Annual Revenue (EUR)" |
| fax | Fax | phone | no | 30 | – | |
| caenCode | SIC Code | text | no | 50 | – | "NNNN Description" |
| industrySpec | Industry Spec | text | no | 50 | – | |
| modifiedBy | Last Modified By | user | – | – | – | read-only, `{id, name}` |
| billingState | Billing State | picklist | yes | 30 | P2 | values carry an ISO 3166-2:RO code (§12 formats) |

The CUI, TVA, Reg no and billing address (with the existing `billingStreet`, `billingCity`,
`billingCode`, `billingCountry`) are also what invoicing-qwbe needs for a buyer. Their accepted
input, stored form and e-Factura limits are in §12, "Identifier and address formats (shared
with invoicing)". One more field, not from vtiger: `billingSector` (Bucharest sector 1-6,
required for `RO-B`); see §12, "Required fields". The mock layer shows it ("Sector", after
Billing State) for a Bucharest county only.

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
- `required` published for `billingStreet`, `billingCity` and `billingCountry` (§9):
  `ORGANIZATION_REQUIRED` leaves `organization-display.ts`.
- `billingState` published **editable**: the form's layout (the Sector for Bucharest,
  `formBlocksOf` in `organization-form.tsx`) keys on the saved record's county today, since the
  mock county cannot change in the form. It must then follow the form's value (`useWatch` on
  `billingState`), so the Sector appears as soon as Bucharest is chosen, on create too.

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

**What the frontend checks (T-1832).** Only the generic check every cube form shares (`lib/validators.ts`, `fieldError`), driven by the published metadata: `required`, `maxLength`, `format: "email"` and whole numbers on `type: "integer"`, the same in the full form, in inline edit and in a list cell. It no longer checks the CUI (check digit, digits only, the "RO" prefix), uniqueness, the IBAN, or hand-written lengths, and it normalises nothing: it sends what the user typed and relies on the backend's refusal (a 422 with per-field `issues`, shown under each field) and on `required` / `maxLength` / `format` in the metadata. One stand-in: the billing street, city and country, required on every save but not published as `required`, are marked required in `organization-display.ts` (`ORGANIZATION_REQUIRED`) until the metadata publishes them; a published `required` wins. An edit checks only the values the user changed, so an older organization without a street still saves a change elsewhere. **Until the backend enforces a rule below or publishes it in the metadata, an invalid value can be saved.**

### Validations the backend must enforce

The rules vtiger applies. Each needs a check and a per-field message on create and update; the generic ones (required, lengths, email) also need publishing in the metadata, so the form checks them before sending.

- [ ] **Required on every save** (Bogdan, 2026-10-17): Organization Name, Form, TVA, CUI,
      Assigned To, Billing Address, Billing City, Billing Country, Billing State, and the
      Sector when the county is Bucharest. Publish the unconditional ones as `required` in the
      metadata; today only `name` is. Until then the form marks and requires the billing
      street, city and country itself, and the mock fields show the flag of the mock metadata,
      read-only. Industry is required by vtiger but optional in the cube: **decide**. TVA is a
      boolean: "required" means "never null", `false` is a valid answer. The full table and the
      foreign organizations: §12, "Required fields".
- [ ] **CUI:** a valid CUI as the company validation pack defines it (§12: format, the "RO"
      prefix, check digit, existence), and **unique** among non-deleted organizations, as a
      per-field issue on `cui`. The refusal should name the existing organization (id and
      name). The input and stored forms of the CUI, TVA, Reg no and billing address are shared
      with invoicing: §12, "Identifier and address formats".
- [ ] **Email:** a valid address. Publish `format: "email"` for it (the frontend attaches it
      today in `organization-display.ts`), and refuse an invalid one.
- [ ] **Lengths:** publish `maxLength` per string field in the metadata (the form already reads it)
      and refuse longer values: vtiger's declared ones are CUI 20, Reg no 20, Industry Spec 50,
      Comp Mobile Phone 15. Until then the form checks no length. The name and billing
      address also have e-Factura limits (name 200, street 150, city 50, postal code 20):
      §12, "Identifier and address formats".
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

- [ ] **CUI format:** digits only, 2 to 10 digits, no leading zero. The "RO" prefix is
      **accepted on input and stored without it**, and it does not set TVA: decided by
      invoicing, which stores the same form (see "Identifier and address formats" below).
      Spaces around it are trimmed.
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

### Identifier and address formats (shared with invoicing)

An organization must be usable as an invoice buyer in invoicing-qwbe with no re-typing or
conversion. Below is what invoicing accepts, stores and sends to e-Factura, read from
`invoicing-qwbe` (branch `main`, 2026-10-17). Every path in this section points into that repo.
Where invoicing has no rule, the text says so and the CRM does not invent one.

**How invoicing takes a buyer.** `BuyerSnapshot` has `partyType`, `vatRegistered`, `name`,
`fiscalIdentifier` and `address {countryCode, city, street, county, sector?, postalCode?}`
(`cube/invoicing/domain/invoice.ts:3-16, 46-49`). It is validated by
`cube/invoicing/parties/domain/party-validation.ts:25-73` and mapped to the UBL buyer by
`standalone/efactura/efactura-mapper-shared.ts:33-41`. An organization is a
`partyType: "company"`. The individual buyer, identified by CNP, is not an organization.

**CUI / CIF** (`cui`)
- *Accepted:* the input is trimmed and upper-cased, then a leading "RO" is dropped, with or
  without a space after it ("ro12345674" and "RO 12345674" both give "12345674"). Invoicing does
  this in its UI (`frontend/src/lib/vat-defaults.ts:6-8`, `frontend/src/lib/customer-form.ts:63-69`).
  Its API only trims and upper-cases (`standalone/api/schema-primitives.ts:11-13`), so a prefix
  sent to the API is refused there. Invoicing has **no rule** for dots, inner spaces or other
  separators: they are not stripped, so the value is refused. In the CRM the backend strips the
  prefix, spaces and dots (backend requirements below); the form sends what was typed.
- *Valid:* `^[1-9]\d{1,9}$` (2 to 10 digits, no leading zero) plus the check digit. The key
  753217532 is aligned to the right of the body, the sum is multiplied by 10 and taken mod 11,
  and 10 counts as 0 (`party-validation.ts:10-23`). ANAF's validator checks this check digit
  before any fiscal rule ("ERRIdentif", `docs/EFACTURA.md:150-153`).
- *Stored:* digits only, without "RO" (`PRODUCT.md:77-80`, `README.md:436-439`).
- *Shown:* `CUI: 12345674`, followed by ` · Cod TVA: RO12345674` for a VAT payer
  (`standalone/documents/pdf-format.ts:24-26`).
- *e-Factura:* BT-47, the buyer legal registration identifier, carries the CUI digits
  (`efactura-mapper-shared.ts:39-40`). BT-32 exists only for the seller (`docs/EFACTURA.md:139-140`).
  BR-RO-120 requires BT-47 and/or BT-48 on the buyer (`cube/efactura/validation.ts:107-113`).

**VAT identifier** (cod TVA) and `vatPayer`
- *Not stored, in invoicing or here.* It is derived as `"RO" + CUI` when the party is a VAT payer
  (`efactura-mapper-shared.ts:9-10`, `README.md:440-441`). Our `vatPayer` is invoicing's
  `vatRegistered` (`invoice.ts:46-49`): an explicit flag, never inferred from a typed "RO"
  (`PRODUCT.md:77-79`, `README.md:436-438`, `frontend/src/components/settings/SettingsHelpVat.tsx:10`,
  `SettingsHelpIdentity.tsx:10`).
- *e-Factura:* BT-48 is `RO<cui>` when `vatPayer` is true, except on an invoice from an
  Article 310 issuer (category O). There BR-O-02 forbids BT-48 and the buyer is identified by
  BT-47 alone (`efactura-mapper-shared.ts:36-37`, `docs/EFACTURA.md:165-175`). A non-payer is sent
  with BT-47 only, which the validator accepts (`docs/EFACTURA.md:188`). BR-CO-09: a VAT
  identifier starts with its upper-case country prefix, `EL` for Greece (`cube/efactura/codelists.ts:66-91`).
- *ANAF status:* invoicing does not look it up. The flag is what the user sets, and the CUI
  lookup is deferred to T-1371 (`docs/VAT_TREATMENT.md:52-55, 145-147`). In the CRM, the pack's
  VAT payer status (above) may prefill `vatPayer`. Invoicing reads only the stored flag.
- *Foreign buyers:* invoicing refuses any country other than RO for every party
  (`party-validation.ts:38`; its UI fixes "România (RO)",
  `frontend/src/components/authoring/BuyerOneTimeFields.tsx:45`) and invoices only in RON
  (`cube/efactura/validation.ts:29-31`). The e-Factura cube itself would accept a foreign VAT
  identifier with its prefix, and a foreign address without a county (`docs/EFACTURA.md:107-112`),
  but nothing feeds it. VIES and non-EU buyers are not mentioned anywhere in invoicing.

**Trade Register no.** (`tradeRegisterNo`)
- *Accepted and stored (issuer only):* trimmed, upper-cased, at most 32 characters, matching
  `^(?:[JF]\d{1,2}\/\d+\/\d{4}|[JF]\d{13})$`. That is either the legacy form `J40/1234/2020`
  (J or F, a county number of 1 or 2 digits, the number, a 4-digit year) or the current ONRC
  form, J or F followed by 13 digits (`cube/invoicing/issuer/domain/issuer-details.ts:12-16`,
  `SettingsHelpIdentity.tsx:12`). "C" and the other old prefixes are not accepted, and no other
  format is documented.
- *e-Factura:* BT-30 for the **seller** only (`efactura-mapper-shared.ts:25`). A buyer's BT-47 is
  its CUI, so invoicing neither stores nor sends a buyer's Reg. Com.: `BuyerSnapshot` has no such
  field. For the CRM this is a format to share, not something invoicing needs from a buyer.

**Legal name** (`name`)
- BT-44, the buyer's registered legal name (`cube/efactura/contracts/document.ts:47`). It is
  required and limited to **200 characters**, counted in characters after collapsing spaces,
  tabs and line breaks (BR-RO-L200: `cube/efactura/cius-limits.ts:63-65`,
  `cube/invoicing/domain/validation.ts:44-48`). Invoicing enforces it on save
  (`party-validation.ts:28, 33`). A longer name is refused, never truncated
  (`docs/EFACTURA.md:113-122`). Invoicing does not compare it with ANAF (T-1371). The pack's name
  check above does. vtiger's 100 is stricter and fits.

**Billing address.** Lengths are counted the same way as the name. Sources:
`party-validation.ts:25-48`, `cius-limits.ts:22-70`, `contracts/document.ts:33-44`,
`efactura-mapper-shared.ts:12-18`, `codelists.ts:27-46`, the `customers` CHECKs in
`cube/invoicing/customers/contracts/migrations.json`.

| CRM field | Invoicing (`address.*`) | e-Factura | Limit / rule | CRM today |
|---|---|---|---|---|
| billingStreet | `street`, required | BT-50 | ≤150, BR-RO-L150 | nullable, vtiger 250 |
| billingCity | `city`, required | BT-52; for RO-B the mapper sends `SECTOR1`..`SECTOR6` instead of the city | ≤50, BR-RO-L050; BR-RO-100 | nullable, vtiger 30 |
| billingState (P2) | `county`, required: one of the 42 ISO 3166-2:RO codes (`RO-CJ`, `RO-B`, ...) | BT-54 | BR-RO-110, a list rather than a shape (`RO-XX` is refused) | P2 label, no code |
| billingSector (new) | `sector`, integer 1-6, required for `RO-B`, forbidden otherwise | becomes BT-52 `SECTORn` | BR-RO-100 | no field |
| billingCode | `postalCode`, optional, no format check | BT-53 | ≤20, BR-RO-L020 | vtiger 30 |
| billingCountry | `countryCode`, required, only `RO` today | BT-55 | ISO 3166-1 alpha-2 from the EN 16931 list, BR-CL-14 | free text, 33 values, ~89% "Romania" |

- **What P2 must carry:** each value has its ISO 3166-2:RO **code** (stored, canonical) and a
  **label** (shown). The list is `cube/invoicing/parties/domain/romanian-counties.ts`: code plus
  the name with diacritics, e.g. `RO-AG` "Argeș", `RO-B` "București". Invoicing prints the name
  it gets from the code (`pdf-format.ts:31-34`). vtiger's 42 counties map one to one. "CE"
  (abroad) has no code; no rule asks a foreign address for a subdivision
  (`docs/EFACTURA.md:109-112`), and what it holds is part of the foreign organizations decision
  ("Required fields").
- **Country:** the canonical form is the upper-case alpha-2 code. The comparison is
  case-sensitive (`ro` is not `RO`, `codelists.ts:22-24`). The EN 16931 list contains `1A` and
  `XI`, but not `UK`. Greece is `GR` as a country and `EL` as a VAT prefix. The country name is
  what gets shown.

**Email and phone:** invoicing has none for a buyer. `BuyerSnapshot` has no contact fields, and
`PRODUCT.md:74, 163` lists them only as optional product fields, which are not implemented. The
e-Factura buyer sends neither a contact nor BT-49 (electronic address), which is deliberately
omitted (`docs/EFACTURA.md:141-143`). There is no invoicing rule, so §9's email rule stands.

### Required fields (organization and address)

What must be filled on **every save**: create and update, from the form, inline edit, import
or API (Bogdan, 2026-10-17). There is no later or "as buyer" check: a saved organization holds
what invoicing needs from a company buyer. The source column says where each rule comes from:
**vtiger** `~M` (§9, spec §4.2), **invoicing** for a company buyer (`party-validation.ts:25-73`
plus the e-Factura rules) and **Bogdan's** decisions. Formats and lengths are in "Identifier and
address formats" above.

The metadata `required` flag is a plain boolean, so the one conditional rule (the sector for
`RO-B`) is enforced by the backend's refusal and is not published as `required`. The UI marks
every field marked **yes** below as required (a red asterisk; the editable ones are refused
empty, in the form and in a list cell): the real fields the metadata does not flag yet through
`ORGANIZATION_REQUIRED` (`organization-display.ts`), the mock ones through the mock metadata.
Industry, still **decide**, is not marked. The Sector shows only for a Bucharest county.

**Organization Information**

| Field | Required | Source |
|---|---|---|
| name | yes | vtiger `~M`. Invoicing: BT-44, `party-validation.ts:28`, at most 200 characters (BR-RO-L200) |
| cui | yes | vtiger `~M`, unique, check digit. Invoicing: required for a company (`party-validation.ts:66`). It is BT-47, which carries BR-RO-120 (`cube/efactura/validation.ts:107-113`). Foreign organizations: decision to take (below) |
| vatPayer | yes: never null, `false` is a valid answer, not "must be true" | vtiger `~M` (checkbox, formal). Invoicing: `vatRegistered` must be a boolean (`party-validation.ts:71`) and it decides BT-48 |
| legalForm | yes | vtiger `~M`. Not used for a buyer: invoicing's `legalForm` is issuer-only (`invoice.ts:29-38`) |
| assignedTo | yes | vtiger `~M`. Not used by invoicing |
| industry | **decide**: vtiger yes, cube optional (§9) | vtiger `~M`. Not used by invoicing |
| customerCategory | no | vtiger optional (88.9% filled). Not used by invoicing |
| tradeRegisterNo | no | vtiger optional. Invoicing sends no buyer Reg. Com. (BT-30 is seller-only, `efactura-mapper-shared.ts:25`) |
| caenCode, organizationType, rating, phone, email, the other fields | no | vtiger optional. Invoicing has no buyer field for them |

**Address**

| Field | Required | Format / length | Source |
|---|---|---|---|
| billingCountry | yes, on save — Bogdan 2026-10-17. Proposal: default `RO` | `RO` | invoicing `party-validation.ts:29, 38`; BT-55, BR-CL-14. vtiger optional (88.8% filled) |
| billingStreet | yes, on save — Bogdan 2026-10-17 | at most 150 | invoicing `party-validation.ts:31`; BT-50, BR-RO-L150. vtiger optional (92.2% filled) |
| billingCity | yes, on save — Bogdan 2026-10-17 | at most 50. Still filled in Bucharest (e.g. "București"): invoicing requires it for `RO-B` too, and only the e-Factura XML carries the sector in its place | invoicing `party-validation.ts:30`; BT-52, BR-RO-L050. vtiger optional (99.1% filled) |
| billingState | yes | one of the 42 ISO 3166-2:RO codes | vtiger `~M`; invoicing `party-validation.ts:32, 39-41`; BT-54, BR-RO-110 |
| billingSector (new) | **yes when `billingState` is `RO-B`**, refused otherwise | integer 1-6, shown as "Sector 3" | **Bogdan, decided 2026-10-17.** Invoicing has the same shape: a separate `address.sector` (`invoice.ts:8`, `party-validation.ts:42-46`, CHECK `customers_bucharest_sector` in `cube/invoicing/customers/contracts/migrations.json`). In e-Factura the mapper sends `SECTOR<n>` as BT-52 in place of the city (`efactura-mapper-shared.ts:14`), as BR-RO-100 requires (`cius-limits.ts:30-32, 50-52`). `SECTOR3` + `RO-B` was accepted by ANAF's validator (`docs/EFACTURA.md:185`). The PDF prints "Sector N" (`pdf-format.ts:34`) |
| billingCode | no | at most 20, no format check | optional in CIUS-RO (`contracts/document.ts:42`) and in invoicing |

**Foreign organizations (`billingCountry` ≠ `RO`): decision to take.** What a non-RO
organization must fill is not decided yet. One decision covers: the identifier (the CUI, or a
foreign tax id in its place, and where it is stored); the VAT code (a foreign VAT identifier with
its country prefix has a field in neither app, and VIES is mentioned nowhere); and County and
Sector, which do not apply (P2 holds Romanian counties only, and no rule asks a foreign address
for a subdivision: `cube/efactura/validation.ts:79-85`, `docs/EFACTURA.md:109-112`). Street, city
and country are asked of every party by the e-Factura cube (`cube/efactura/validation.ts:76-78`,
`codelists.ts:79-84`). **Invoicing does not accept foreign buyers today:** it refuses any country
other than `RO` (`party-validation.ts:38`), so a foreign organization cannot become an invoice
buyer, whatever the CRM stores. The UI does nothing specific for them until this is decided.

### Gaps, backend requirements and open decisions (formats and required fields)

**Gaps:** what invoicing needs that the organization lacks or holds in another form.
- `billingState` has no ISO code. `billingCountry` is free text, not an ISO code.
- There is no Bucharest **sector** field in the cube: `billingSector` is new (Required fields);
  the UI shows it as a mock until then.
- `billingStreet` (250) and `billingCode` (30) allow more than e-Factura (150, 20).
- Street, city and country are required on every save but nullable and not `required` in the
  cube (filled on 92.2%, 99.1% and 88.8% of the organizations).
- Foreign organizations: the decision to take above.
- Optional only: invoicing's customer has `defaultPaymentTermDays`
  (`cube/invoicing/customers/domain/customer.ts:6-13`), which the organization lacks. It is not
  required for issuing.

**Backend requirements derived from it**
- [ ] **Normalisation is the backend's job** (Bogdan, 2026-10-17): the frontend sends what the
      user typed and formats nothing. The backend trims every value, then normalises before it
      validates and stores: `cui` loses a leading "RO" / "ro" / "RO " and any inner spaces or
      dots; `tradeRegisterNo` is upper-cased; an IBAN-like identifier (in a custom field) loses
      its spaces and is upper-cased; the county becomes its ISO 3166-2:RO code and the country
      its upper-case ISO 3166-1 alpha-2 code ("Romania", "ro" → `RO`). A value it cannot
      normalise is refused per field, never guessed.
- [ ] Store `cui` as digits only, without "RO". After normalising, refuse a leading zero, a
      length outside 2-10 and a wrong check digit. These merge into the pack's CUI rules above.
- [ ] Never store a VAT identifier. `vatPayer` is explicit and is never set from a typed prefix.
      Anyone who needs the VAT identifier derives it as `RO<cui>`.
- [ ] `tradeRegisterNo`: accept invoicing's two forms (legacy `J40/1234/2020`, current J/F + 13
      digits). Both fit vtiger's 20.
- [ ] Publish the P2 (`billingState`) values with their ISO 3166-2:RO code and label, and store
      the code. Refuse anything outside the 42 codes for a Romanian address. vtiger's "CE"
      (abroad) goes with the foreign organizations decision.
- [ ] New field `billingSector`: an integer 1-6, required when `billingState` is `RO-B` and
      refused otherwise (Bogdan, 2026-10-17; invoicing's shape). Publish it in the metadata. In
      vtiger's data the sector, if any, sits in the city or street text: import it in dry-run
      and report what does not map.
- [ ] Required on every save, as in "Required fields": `name`, `cui`, `vatPayer` (never null),
      `legalForm`, `assignedTo`, `billingStreet`, `billingCity`, `billingCountry`,
      `billingState`, and `billingSector` for `RO-B`. Publish the unconditional ones as
      `required` in the metadata and enforce the conditional one with a per-field refusal. An
      update that leaves an empty required field of an older organization untouched is not
      refused for it (the UI sends only what changed); the import reports those gaps.
- [ ] `billingCountry`: a code from the EN 16931 list, default `RO`. The country name is shown.
- [ ] Lengths, counted in characters after collapsing whitespace: `name` 200 (vtiger's 100
      stays the stricter limit), `billingStreet` 150, `billingCity` 50 (vtiger 30), `billingCode`
      20. Publish them as `maxLength` (§9). A longer value is refused, never truncated.
- [ ] Import (dry-run first): map vtiger's county labels, "CE", the 21 out-of-list Billing State
      values (spec §5.2), the free-text countries and any CUI with "RO" to the canonical forms.
      A value that does not map is reported, not guessed. Saved views that filter
      `bill_state` by county name move with the values.

**Open decisions**
- [ ] Industry: required (vtiger) or optional (the cube)? (§9)
- [ ] Foreign organizations: what a non-RO organization requires (Required fields, above).
- [ ] Reg. Com. values outside the two forms (e.g. "C", other old shapes) at import: keep them
      as they are, or refuse them?
