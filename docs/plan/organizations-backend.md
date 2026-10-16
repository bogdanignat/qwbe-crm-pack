# Organizations: what the backend needs for the mock to disappear

The backend work the Organizations UI waits for, step by step. Until it is done the UI shows made-up fields and records, marked and read-only; once it is done that mock layer can be deleted.

Epic T-1809. This document says WHAT is needed, not HOW. Each UI step completes it.
Full specification: `organizations-ui-spec.md` (§5 fields, §8 the base list).

The frontend mockup layer: `frontend/src/mock/organizations/`
(`fields.json`, `picklists.json`, `organizations.json`, `index.ts`).
A mock field disappears on its own as soon as `GET /catalog/crm%2Forganizations/metadata`
publishes a field with the same name; the frontend does not change.

## 1. Fields missing from the cube (step 1, T-1811)

The 33 vtiger fields the organizations cube does not have yet. Without them the detail page and the list show mock values instead of real data.

All 33, with the names below, readable and writable (except the read-only ones).
Type, required flag, length and picklist are the vtiger ones (§5.2); the exact source
is `frontend/src/mock/organizations/fields.json`. The 33 fields and the picklists P1, P2,
P3, P5, P7 and P8 were checked against the vtiger database; P4, P6 and P9 are complete
lists from it (vtiger order, normalized, without "--None--").

**Target** (Bogdan's decision): only the fields worth porting go into the cube, the rest
become runtime custom fields of `crm/organizations`, under the same names.

- **cube (24):** cui, legalForm, vatPayer, tradeRegisterNo, customerCategory, caenCode,
  industrySpec, assignedTo, modifiedAt, modifiedBy, otherPhone, mobilePhone, fax, otherEmail,
  annualRevenue, turnoverEur, bank, iban, billingState, shippingStreet, shippingCity,
  shippingState, shippingCode, shippingCountry.
- **custom (9):** otherIndustry, otherIndustrySpec, productCategory, otherFax, billingPoBox,
  shippingPoBox, tickerSymbol, notifyOwner, parentOrganizationId.

The UI already treats the 9 as custom fields (`custom: true`, value in `row.custom`, a
CUSTOM marker after the label). On the detail page they stay in their vtiger blocks, where
`src/lib/organization-layout.ts` names them (Other Industry in Organization Information,
the PO Boxes in Address Information, and so on), and a test keeps them there; only a
runtime custom field the layout does not name goes to the "Custom fields" block. In the
list they are hidden by default and can be picked in Columns. Once they are real custom
fields nothing moves: the layout names them, and the list keeps them out of its defaults.

| Name | Label (en_us) | Target | Type | Req. | Length | Picklist | Notes |
|---|---|---|---|---|---|---|---|
| modifiedAt | Modified Time | cube | datetime | – | – | – | read-only |
| otherIndustry | Other Industry | custom | picklist | no | 255 | P6 | |
| legalForm | Form | cube | picklist | yes | 255 | P1 | |
| otherIndustrySpec | Other Industry Spec | custom | text | no | 255 | – | |
| vatPayer | TVA | cube | boolean | yes (formal) | – | – | |
| cui | CUI | cube | text (digits) | yes | 20 | – | unique + check digit |
| tradeRegisterNo | Reg no | cube | text | no | 20 | – | |
| customerCategory | Category | cube | picklist | no | 255 | P7 | |
| bank | Bank | cube | picklist | no | 255 | P8 | |
| productCategory | Product Category | custom | picklist | no | 255 | P9 | |
| iban | IBAN | cube | text | no | 50 | – | |
| assignedTo | Assigned To | cube | user or group | yes | – | – | `{type, id, name}` |
| parentOrganizationId | Member Of | custom | relation to crm/organizations | no | – | – | |
| otherPhone | Other Phone | cube | phone | no | 30 | – | |
| mobilePhone | Comp Mobile Phone | cube | phone | no | 15 | – | |
| annualRevenue | Annual Revenue | cube | integer (EUR) | no | – | – | UI label "Annual Revenue (EUR)" |
| fax | Fax | cube | phone | no | 30 | – | |
| otherFax | Other Fax | custom | text | no | 15 | – | |
| caenCode | SIC Code | cube | text | no | 50 | – | "NNNN Description" |
| tickerSymbol | Ticker Symbol | custom | text | no | 30 | – | 0% used, skipped at import |
| otherEmail | Other Email | cube | email | no | 100 | – | |
| turnoverEur | Account Turnover (€) | cube | integer (EUR) | no | 10 digits | – | UI label "Account Turnover (EUR)" |
| notifyOwner | Notify Owner | custom | boolean | no | – | – | 0% used, skipped at import |
| industrySpec | Industry Spec | cube | text | no | 50 | – | |
| modifiedBy | Last Modified By | cube | user | – | – | – | read-only, `{id, name}` |
| shippingStreet | Shipping Address | cube | textarea | no | 250 | – | |
| billingPoBox | Billing PO Box | custom | text | no | 30 | – | |
| shippingPoBox | Shipping PO Box | custom | text | no | 30 | – | |
| shippingCity | Shipping City | cube | text | no | 30 | – | |
| billingState | Billing State | cube | picklist | yes | 30 | P2 | |
| shippingState | Shipping State | cube | text (P2 proposed) | no | 30 | – | |
| shippingCode | Shipping Postal Code | cube | text | no | 30 | – | |
| shippingCountry | Shipping Country | cube | text | no | 30 | – | |

### Import and data notes

Points to settle when vtiger's data is imported into the new fields. They keep the import from losing or inventing data.

- [ ] `tickerSymbol` and `notifyOwner` hold no data (0%): the import can skip them.
- [ ] `parentOrganizationId` is a relation (Member Of): check whether custom fields support a
      relation to `crm/organizations`; if not, it needs another home.
- [ ] Bank values in vtiger carry NBSP (U+00A0); the import must normalize them to plain
      spaces, otherwise they do not match the P8 picklist.
- [ ] IBAN is filled mostly on real customers (53% of the organizations with an IBAN have
      quotes or orders): import it without loss.
- [ ] **Currency:** a single currency for every amount, configured at qwbe level 0. EUR for now;
      the UI labels say "(EUR)" until the backend publishes the configured currency.
- [ ] **Open question, low priority:** `annualRevenue` and `turnoverEur` are both kept for now.
      `turnoverEur` (8,9% filled, used in 2 filter columns) seems to duplicate `annualRevenue`
      (35,5% filled, 68 filter columns); whether both are needed stays open.
- [ ] `otherEmail` (6,1%) and the `shipping*` fields (7,9%) are sparsely filled.

## 2. Metadata

What the cube's metadata must publish so the UI can build itself from it. Today the frontend fills these gaps by hand, and each hand-made piece can drift from the backend.

- [ ] Picklists as `enum` in the metadata, with the vtiger values and order: P1, P2,
      P6–P9 on the new fields; P3 on `organizationType`, P4 on `industry`, P5 on `rating`
      (all three are `enum: null` today). Optionally filtered by role, as in 5.4.
- [ ] A display format for text fields: `email`, `phone`, `url`. Today the metadata publishes
      `phone`, `email` and `website` as plain `type: "string"`, with no format, so the UI
      supplies one to show them as tel:/mailto:/http links, as vtiger does: for the real
      fields in `frontend/src/lib/organization-display.ts`, for the mock ones in
      `fields.json` (otherPhone, mobilePhone, fax: phone; otherEmail: email). A format the
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
- [ ] `parentOrganizationId` published as a relation to `crm/organizations`.
- [ ] `modifiedAt`, `modifiedBy`, `createdAt` read-only (`editable: false`).

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
      field), Send Mail (choose Email or Other Email, compose, keep the history), Mailer Export
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
      organization); IBAN, email and length validation, the same in the form and inline edit.
- [ ] Filters with operators and AND/OR groups; relative date filters; saved views.
- [ ] Shipping address; optionally propagating the address to contacts.
- [ ] Duplicate detection and merging (CUI, name).
- [ ] Comments, email to the organization and its history, prev/next in the list (optional).
- [ ] The missing related modules (§3.5) and the SELECT relations (link/unlink).
- [ ] Permissions per action and visibility by owner/role.

## 5. What disappears from the frontend when the backend is ready

What each backend piece removes from the frontend on its own, without a code change. It shows which work brings real data to the pages fastest.

- A field of §1 published under the same name: its mock disappears automatically.
- Picklists published as `enum`: `picklists.json` is no longer needed.
- The 9 custom-target fields defined as custom fields under the same names: their mocks
  disappear the same way (a real field, custom or not, wins by name).
- The demo organizations (`organizations.json`, `org_mock_001..003`) need nothing from
  the backend; they go once the real organizations carry the new data.
- The `rating` label stays: it is a UI decision, not part of the mock.

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
4. `src/lib/relation-batch.ts`: the `demoOrganizationOf` import, the demo skip in
   `relationRefsOf`, and `demoTitleOf`.
5. `src/hooks/use-relation-titles.ts`: the `demoTitleOf` import and its `??` fallback in
   `resolve` (back to `?? null`).
6. The list (T-1813): `src/hooks/use-list-query.ts` (the `withMockFields` import and call),
   `src/components/cube-list.tsx` (the `demoRows` prop, `demoRowsMatching`, and `empty` becomes
   `page.rows.length === 0`), `src/components/list/list-table.tsx` (the demo rows, their
   disabled checkbox and the `MockTag`; the `FieldMarker` in the headers),
   `src/components/list/demo-row-checkbox.tsx`, `listWindowOf`'s demo rows and its demo counts
   in `src/lib/cube.ts`,
   `src/components/organizations/organization-list.tsx` (`DEMO_ORGANIZATIONS`, the demo branch of
   the row menu) and `src/lib/demo-search.ts` with its test (keep `matchesPrefix` if the palette
   still needs it).
7. `src/hooks/use-cube-metadata.ts`: the `withMockFields` import and call.
   `src/components/kit/cube-show.tsx`: the `MockTag` import and call, and the `demo` prop with
   its three uses (editable fields, pencil, title tag).
   `src/components/organizations/`: the `MockTag` use in organization-header, the
   `FieldMarker` uses (organization-info, contacts-table) with `src/lib/field-marker.ts` and
   `src/components/field-marker.tsx`, and the `demo` prop (organization-detail,
   organization-header, related-contacts, with the `demoContactsOf` slice there).
   `src/hooks/use-duplicate-values.ts`: the `demoOrganizationOf` guard. The read-only previews
   `src/components/sharing-preview.tsx` and `activity-preview.tsx` go with their `demo`
   branches. `src/lib/organization-layout.ts` keeps the vtiger rows; a test there reads
   `VTIGER_PLACEMENT` and goes with the mock.
8. `src/components/cube-create-form.tsx`: the `withMockFields` import and call.
9. `src/app/organizations/[id]/page.tsx`: the `demoOrganizationOf` import and the `demo` flag.
10. `src/lib/organization-display.ts`: the `picklists.json` import and `ORGANIZATION_ENUMS`
    (with their test), once the backend publishes the three enums (§9).
11. `src/lib/cube.ts`: `mock?` in `FieldMetadata`, `&& !field.mock` in `canEdit`, the
    `!(field.mock && field.custom)` part of `visible` in `columnsFromFields`, the mock
    refusal in `saveCell`, the mock skip in `createPayloadOf`, and the `demoRows`
    parameter of `listWindowOf` (with the "+N demo" part of its label).
12. `src/lib/kit-form.ts`: the mock skip in `updatePayloadOf`.
13. `src/lib/global-search.ts`: the `DEMO_ORGANIZATIONS` and `ORGANIZATIONS_CUBE` imports,
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
  - Show Organization Hierarchy: the Member Of tree (`parentOrganizationId` as a real relation,
    parents and children of a record). Little used (12 organizations, spec §7).
  - Send SMS: an SMS provider and the SMS Notifier history.
- [ ] **Send Mail** works as a `mailto:` to the organization's email. vtiger's version (choose the
      address, send from the CRM, keep the email in the history) needs an email module.
- [ ] **Mail Merge** (Word templates, 2 for Organizations) and **EMAILMaker** (22 email templates):
      not built. Mail Merge is not worth copying (spec §7); EMAILMaker needs templates and sending
      on the server.
- [ ] **Locate Map** (Address Information, Google Maps on the billing or shipping address): not
      built; a plain map link needs nothing from the backend, a stored geocode would.
- [ ] **Inline edit validation** as in the form: CUI unique + check digit, IBAN, email, lengths
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
- [ ] **IBAN:** RO format (RO, 2 check digits, 4-letter bank code, 16 letters or digits) and the
      mod-97 checksum; store it without spaces, upper case.
- [ ] **Email:** Email and Other Email, a valid address. Publish `format: "email"` for both (the
      frontend attaches it today: `organization-display.ts` for Email, the mock for Other Email).
- [ ] **Lengths:** publish `maxLength` per string field in the metadata (the form already reads it)
      and refuse longer values; until then the form uses the declared ones (CUI 20, Reg no 20,
      IBAN 50, Industry Spec 50, Other Industry Spec 255, Comp Mobile Phone 15, Other Fax 15).
- [ ] **Whole numbers:** Employees, Annual Revenue; Account Turnover numeric without decimals.

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
- [ ] **Shipping address, PO Box and Billing State** as real fields: the two address copy
      buttons are disabled ("Needs backend") until every target field is editable.
- [ ] **ANAF lookup** by CUI (name, address, Trade Register no., VAT) for a "Fill from ANAF"
      action: an idea, not built.
