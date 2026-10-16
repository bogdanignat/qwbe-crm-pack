# Organizations: what the backend needs for the mock to disappear

Epic T-1809. This document says WHAT is needed, not HOW. Each UI step completes it.
Full specification: `organizations-ui-spec.md` (§5 fields, §8 the base list).

The frontend mockup layer: `frontend/src/mock/organizations/`
(`fields.json`, `picklists.json`, `organizations.json`, `index.ts`).
A mock field disappears on its own as soon as `GET /catalog/crm%2Forganizations/metadata`
publishes a field with the same name; the frontend does not change.

## 1. Fields missing from the cube (step 1, T-1811)

All 33, with the names below, readable and writable (except the read-only ones).
Type, required flag, length and picklist are the vtiger ones (§5.2); the exact source
is `frontend/src/mock/organizations/fields.json`.

| Name | Label (en_us) | Type | Req. | Length | Picklist | Notes |
|---|---|---|---|---|---|---|
| modifiedAt | Modified Time | datetime | – | – | – | read-only |
| otherIndustry | Other Industry | picklist | no | 255 | P6 | |
| legalForm | Form | picklist | yes | 255 | P1 | |
| otherIndustrySpec | Other Industry Spec | text | no | 255 | – | |
| vatPayer | TVA | boolean | yes (formal) | – | – | |
| cui | CUI | text (digits) | yes | 20 | – | unique + check digit |
| tradeRegisterNo | Reg no | text | no | 20 | – | |
| customerCategory | Category | picklist | no | 255 | P7 | |
| bank | Bank | picklist | no | 255 | P8 | |
| productCategory | Product Category | picklist | no | 255 | P9 | |
| iban | IBAN | text | no | 50 | – | |
| assignedTo | Assigned To | user or group | yes | – | – | `{type, id, name}` |
| parentOrganizationId | Member Of | relation to crm/organizations | no | – | – | |
| otherPhone | Other Phone | phone | no | 30 | – | |
| mobilePhone | Comp Mobile Phone | phone | no | 15 | – | |
| annualRevenue | Annual Revenue | integer (EUR) | no | – | – | |
| fax | Fax | phone | no | 30 | – | |
| otherFax | Other Fax | text | no | 15 | – | |
| caenCode | SIC Code | text | no | 50 | – | "NNNN Description" |
| tickerSymbol | Ticker Symbol | text | no | 30 | – | 0% used, decide whether it stays |
| otherEmail | Other Email | email | no | 100 | – | |
| turnoverEur | Account Turnover (€) | integer | no | 10 digits | – | |
| notifyOwner | Notify Owner | boolean | no | – | – | 0% used, decide whether it stays |
| industrySpec | Industry Spec | text | no | 50 | – | |
| modifiedBy | Last Modified By | user | – | – | – | read-only, `{id, name}` |
| shippingStreet | Shipping Address | textarea | no | 250 | – | |
| billingPoBox | Billing PO Box | text | no | 30 | – | |
| shippingPoBox | Shipping PO Box | text | no | 30 | – | |
| shippingCity | Shipping City | text | no | 30 | – | |
| billingState | Billing State | picklist | yes | 30 | P2 | |
| shippingState | Shipping State | text (P2 proposed) | no | 30 | – | |
| shippingCode | Shipping Postal Code | text | no | 30 | – | |
| shippingCountry | Shipping Country | text | no | 30 | – | |

## 2. Metadata

- [ ] Picklists as `enum` in the metadata, with the vtiger values and order: P1, P2,
      P6–P9 on the new fields; P3 on `organizationType`, P4 on `industry`, P5 on `rating`
      (all three are `enum: null` today). Optionally filtered by role, as in 5.4.
- [ ] The complete lists for P4 (123), P6 (83) and P9 (102); the mock has only the first 20.
- [ ] The vtiger en_us labels on the existing fields, where they differ: Type (today
      "Organization Type"), Billing Address ("Billing Street"), Billing Postal Code
      ("Billing Code"), Created Time ("Created At"), Organization Name ("Name").
      `rating` is shown as "Company status" (in vtiger it is the company's legal status);
      that one is a UI decision and stays in the frontend (`lib/organization-labels.ts`).
- [ ] The maximum length of every text field, so the UI can validate before saving.
- [ ] A published type for the user/group references (`assignedTo`, `modifiedBy`); the UI
      shows `name`.
- [ ] `parentOrganizationId` published as a relation to `crm/organizations`.
- [ ] `modifiedAt`, `modifiedBy`, `createdAt` read-only (`editable: false`).

## 3. List

- [ ] Sorting on any displayed column (today only name, industry, createdAt); default
      Modified Time descending, as in vtiger.
- [ ] Text search on name, CUI, email, phone (partial).
- [ ] Exact filters at least on billingState, legalForm, rating, assignedTo.
- [ ] Total in the list response (exists today) and a configurable page size.

## 4. The rest of §8 (the next steps detail it)

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

- A field of §1 published under the same name: its mock disappears automatically.
- Picklists published as `enum`: `picklists.json` is no longer needed.
- The demo organizations (`organizations.json`, `org_mock_001..003`) need nothing from
  the backend; they go once the real organizations carry the new data.
- The `rating` label stays: it is a UI decision, not part of the mock.

## 6. Retiring the mock layer

A mechanical deletion, all under `frontend/`. Nothing outside this list refers to the mock.

1. Delete `src/mock/` (fields, picklists, demo records, `withMockFields`, its tests).
   `VTIGER_PLACEMENT` and `PICKLISTS` are used by the detail and form steps: move what
   they still need first, or retire them with the steps that use them.
2. Delete `src/components/mock-tag.tsx`.
3. `src/lib/qwbe-data-provider.ts`: the `demoOrganizationOf` import, the demo branch in
   `getOne` and the demo refusal in `update`.
4. `src/lib/relation-batch.ts`: the `demoOrganizationOf` import, the demo skip in
   `relationRefsOf`, and `demoTitleOf`.
5. `src/hooks/use-relation-titles.ts`: the `demoTitleOf` import and its `??` fallback in
   `resolve` (back to `?? null`).
6. `src/components/cube-list.tsx`: the `withMockFields` and `MockTag` imports and calls,
   the `demoRows` prop, the demo rows in the table body, and `listWindowOf`'s `demo`
   (`empty` becomes `page.rows.length === 0`).
7. `src/components/kit/cube-show.tsx`: the `withMockFields` and `MockTag` imports and
   calls, and the `demo` prop with its three uses (editable fields, pencil, title tag).
8. `src/components/cube-create-form.tsx`: the `withMockFields` import and call.
9. `src/app/organizations/page.tsx`: the `DEMO_ORGANIZATIONS` import and the `demoRows` prop.
   `src/app/organizations/[id]/page.tsx`: the `demoOrganizationOf` import and the demo branch.
10. `src/lib/cube.ts`: `mock?` in `FieldMetadata`, `&& !field.mock` in `canEdit`, the mock
    refusal in `saveCell`, the mock skip in `createPayloadOf`, and the `demoRows`
    parameter of `listWindowOf`.
11. `src/lib/kit-form.ts`: the mock skip in `updatePayloadOf`.
12. `src/lib/global-search.ts`: the `DEMO_ORGANIZATIONS` and `ORGANIZATIONS_CUBE` imports,
    `DEMO_ROWS`, and `demoRows` (in `SearchModule`, `SEARCH_MODULES` and `searchModule`).

What stays: `withOrganizationLabels` (`src/lib/organization-labels.ts`) and
`valueTextOf` (reference objects such as `assignedTo` once the backend publishes them).

## 7. Main menu (step 2, T-1812)

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
- [ ] Optional: a capability in `/auth/me` saying whether the user may open Settings. Today the
      menu shows Settings when `roles` contains `admin` (the test the activity feed uses); the
      page and the backend still check `customfields:write` themselves.
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
In the menu today: Sales → Organizations, Contacts; Tools → Echo (the activity feed);
Settings (admin) at the bottom; Preferences (`/me`) in the account menu.
