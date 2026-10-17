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
- [ ] **Quick search on name, CUI, email and phone, partial.** `q` scans `name`, `industry` and
      `externalId` as a prefix of the whole value; the search box says "Name or industry starts
      with…". CUI is not published yet (§1); email and phone are not search fields.
- [ ] **A-Z letter bar** (Organization Name *starts with* a letter): needs a prefix filter on the
      name alone; `q` would also match the industry. Not built.
- [ ] **Exact filters** at least on billingState, legalForm, rating, assignedTo, and filters with
      operators (contains, greater than) for the vtiger filter conditions (spec §2.3). Today: `name`,
      `industry`, `externalId`, behind "Filters" with a chip each.
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
- [ ] Server-side CUI validation (unique + check digit, message naming the existing
      organization); email and length validation, the same in the form and inline edit.
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
- [ ] **Partial search**: `q` is a case-insensitive prefix of the whole value (verified on
      dev: "srl" does not find "Acme SRL", "one" does not find "HINT ONE ZERO"). The palette
      needs a match inside the value (at least on every word), on name, CUI, email and phone
      (see §3).
- [ ] **Why a record matched**: the field that matched, or a short subtitle (city, CUI, a
      contact's organization), so two hits with the same name can be told apart.
- [ ] **The user's display name** in `/auth/me` (first and last name); today only `username`,
      which is what the account menu shows.
- [ ] **Partial global search across several fields with a module filter**: one search over at
      least name, CUI, email and phone, matching inside the value, with a filter on the module
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
- [ ] **Inline edit validation** as in the form: CUI unique + check digit, email, lengths
      (same rules in both places, §4 above).
- [ ] **Duplicate** (T-1815) copies every editable field the backend publishes, except
      `externalId` and Organization No. A full prefilled copy needs every field of §1 in the cube.

## 9. Create / edit form (step 5, T-1815)

What the organization form (create, Duplicate, Edit all; spec §4.5) needs from the backend. The form checks these rules in the browser, but a browser check is only a convenience: the backend must refuse the same mistakes, for the form, inline edit, import and any API client.

### Validations the backend must enforce

The rules the form already applies on the client. Each needs the same check, and a per-field message, on create and update.

- [ ] **Required:** Organization Name, Form, TVA, CUI, Assigned To, Industry, Billing State
      (vtiger `~M`). Publish them as `required` in the metadata; today only `name` is, so the
      form keeps its own list (`ORGANIZATION_REQUIRED`). Industry is required by vtiger but
      optional in the cube: decide which wins (the form requires it, so a real organization
      with an empty Industry cannot be saved through Edit all until it is filled). TVA is a
      boolean: "required" means "never null", not "true".
- [ ] **CUI:** digits only, 2 to 10 digits, check digit with the key 753217532 (the "RO"
      prefix refused, not stripped), and **unique** among non-deleted organizations. The
      refusal should name the existing organization (id and name), so the form can link to it.
- [ ] **Email:** a valid address. Publish `format: "email"` for it (the frontend attaches it
      today in `organization-display.ts`).
- [ ] **Lengths:** publish `maxLength` per string field in the metadata (the form already reads it)
      and refuse longer values; until then the form uses the declared ones (CUI 20, Reg no 20,
      Industry Spec 50, Comp Mobile Phone 15).
- [ ] **Whole numbers:** Employees, Annual Revenue.

- [ ] **Picklists:** publish `enum` for `organizationType` (P3), `industry` (P4) and `rating` (P5),
      and refuse a value outside it on create and update. The frontend attaches vtiger's values
      today (`ORGANIZATION_ENUMS` in `organization-display.ts`); a published enum wins. Decide what
      happens to the stored values outside the list (legacy Industry values): the UI keeps them
      visible and selectable, so a migration or an "other" mapping is needed before the backend
      refuses them.

### Other needs found

What else the form relies on or works around. None blocks the form; each removes a stand-in.

- [ ] **Refusals per field:** a 422 with `issues` (path + message) per field, so the form can
      show the message under its field instead of above the form.
- [ ] **Organization No** generated on create (vtiger `ACC<n>`) and read-only; today it is a
      plain editable string, so the form edits it, and Duplicate leaves it empty.
- [ ] **Assigned To** as a relation to users and groups (vtiger's User / Group choice); the form
      shows it disabled until then, and takes the existing user picker once it is published.
- [ ] **ANAF lookup** by CUI (name, address, Trade Register no., VAT) for a "Fill from ANAF"
      action: an idea, not built.

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
