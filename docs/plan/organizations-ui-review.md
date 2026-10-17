# Review React — Organizations (vtiger UI)

Branch `feature/organizations-vtiger-ui`, T-1825. Recomandările au fost reverificate
în codul actual al branch-ului (care a avansat față de momentul review-ului); fiecare
punct spune dacă mai e valabil.

## Starea verificată acum

- Lint: 0 erori, 1 warning (`use-relation-titles.ts:83`,
  ref citit în cleanup-ul unui effect).
- Typecheck (`tsc --noEmit`, inclusiv `e2e`): curat.
- Teste unitare: 391/391 trec (117 suite).
- Fără browser / E2E: fluxul vizual nu a fost verificat automat.

## Ce a mers bine

- Structura React e curată: componente mici cu o singură responsabilitate, logica
  trasă în `lib/` (mapări, validări, URL) cu teste proprii, hook-uri separate de
  prezentare. Paginile din `app/` compun, în general, componentele.
- Stilul pare consistent: componente kit (`ui/button`, `ui/badge`) cu variante
  prin `cva` și `cn()` la combinarea claselor; în ce am revizuit n-am găsit
  `style={{}}` sau CSS ad-hoc, dar nu am făcut o trecere exhaustivă pe stil.

## Prioritare

### 1. Validarea inline diferă de OrganizationForm — ÎNCĂ VALABIL

Codul s-a mutat între timp (pencil-ul din `organization-info.tsx` duce spre
`kit/inline-field.tsx` + `hooks/use-in-place-edit.ts`), dar diferența a rămas:
salvarea inline verifică doar câmpurile obligatorii lipsă (`changedPayloadOf`,
`lib/kit-form.ts`) plus refuzul din backend, în timp ce `OrganizationForm` aplică
toate regulile din `lib/organization-validation.ts` (CUI, email, lungimi
maxime) pe blur și pe submit. O valoare invalidă poate ajunge la PATCH prin
editarea inline, dar e refuzată client-side în formular (serverul o poate refuza
și la PATCH). Repar: o singură sursă de reguli, apelată și din
`use-in-place-edit.ts`.

### 2. Metadata de cube se aduce și se decorează în 3 locuri — ÎNCĂ VALABIL

Aceeași secvență `apiFetch(metadataApiPath)` + `withOrganizationDisplay(withMockFields(...))`
există în:

- `hooks/use-cube-metadata.ts` (prin react-query, partajat corect),
- `hooks/use-list-query.ts:42` (`useCubeMeta` local, cu `useState`/`useEffect`),
- `components/cube-create-form.tsx` (fetch inline în componentă).

Repar: extrage secvența într-o funcție partajată de tip `fetchCubeMetadata`
(fetch + decorare, în `lib/`), apelată de toți cei trei consumatori — ca
`queryFn` în `use-cube-metadata.ts`, direct în `useCubeMeta` și în
`cube-create-form`. Așa se elimină duplicația fără a presupune că lista are
`QueryClientProvider`, deci fără a muta totul prin `useCubeMetadata` (react-query
pe aceste suprafețe rămâne o decizie separată).

## Minore

### 3. Răspuns stale în `use-cell-edits.ts` — ÎNCĂ VALABIL

Erorile sunt cheiate pe `queryKey` și `byCell` expune doar erorile cheii
curente, dar scrierea nu e protejată: `setCell` (`use-cell-edits.ts:25`)
folosește `queryKey`-ul capturat la momentul apelului `save`. Scenariul: deschizi
o celulă pe pagina A, salvezi, apoi navighezi pe pagina B în timp ce request-ul
e în zbor; când răspunsul pentru A ajunge, `setCell` face `setErrors` cu
`key: A` și înlocuiește complet starea — erorile deja afișate pe pagina B se
pierd. Guard-ul de citire din `byCell` nu ajută, pentru că rescrierea a distrus
deja erorile lui B. Repar: în updater-ul lui `setCell`, compară cheia capturată
cu `current.key` — dacă diferă, răspunsul e stale și se aruncă (starea rămâne
neatinsă), nu se rescrie.

### 4. ID-uri encodate diferit în Open vs Edit — ÎNCĂ VALABIL

`rowHref` (`lib/cube.ts`) nu encodează; Open trece id-ul brut
(`organization-list.tsx`, `related-contacts.tsx` `hrefOf`), în timp ce Edit
encodează (`organizationEditHref`, respectiv `editHrefOf`). Un id cu caractere
speciale dă un link Open greșit și un Edit corect. Repar: se encodează o singură
dată, în `rowHref`, și se scoate `encodeURIComponent` din apelanți.

### 5. Cookie `sidebar_state` scris, niciodată citit — ÎNCĂ VALABIL

`ui/sidebar.tsx:86` scrie cookie-ul la fiecare toggle, dar nimeni nu-l citește
(nici `defaultOpen`, nici `app-sidebar.tsx`). Fie se citește la deschidere
(starea sidebar-ului supraviețuiește reload-ului), fie se renunță la scriere.

### 6. `list/list-cell.tsx` duplică `kit/field-value.tsx` — ÎNCĂ VALABIL (parțial)

Randarea valorii (link de relație, `FormatLink`, învelișul mono) e rescrisă în
`ListCell`, în timp ce `kit/field-value.tsx` face deja același lucru pentru
paginile de detalii; doar `isMonoValue` e partajat. Repar: `ListCell` folosește
`FieldValue` pentru starea needitabilă și păstrează doar clamp-ul, link-ul de
rând și butonul de edit.
