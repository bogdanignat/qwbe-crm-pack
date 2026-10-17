# Organizations: the mock data

The Organizations UI shows fields and records the `crm/organizations` cube does not have yet,
so the pages could be built and reviewed before the backend. That mock layer lives in
`frontend/src/mock/organizations/` (`fields.json`, `picklists.json`, `organizations.json`,
`contacts.json`, merged by `index.ts`). It disappears field by field: as soon as
`GET /catalog/crm%2Forganizations/metadata` publishes a field under the same name, its mock
vanishes with no frontend change (organizations-backend.md §5); once the backend has everything,
`src/mock/` is deleted (organizations-backend.md §6).

This file keeps a **frozen copy** of the four files, so the shapes and sample values stay the
reference for the backend after `src/mock/` is gone. Each JSON below is the file verbatim; the
check at the end recreates the files from it byte for byte.

Everything is made up: no real customer, person, CUI, Trade Register no., phone or email domain
(checked as absent from the vtiger database). The picklist values are the real vtiger ones.

## How the mock is merged

- `withMockFields` (`index.ts`) appends every mock field the published metadata lacks, marked
  `mock: true`, never sortable or searchable. A published field of the same name wins.
- Mock fields are read-only everywhere (`canEdit` is false) and never travel: they are dropped
  from every create, Duplicate, PATCH and inline save body.
- The three demo organizations ride on the list's first page, outside the server's range and
  total ("+3 demo"), open from the mock without calling the backend, and are refused on update
  ("read-only"). Their contacts appear only in the Contacts related list of `org_mock_001`.

## fields.json

The 22 fields the UI needs and the cube does not publish yet: the 20 vtiger fields kept
(organizations-ui-spec.md §5.2) and two Bucharest sectors that are not vtiger fields.

Each entry is the published metadata shape plus where vtiger places it:
`name`, `label`, `type` (`string`, `integer`, `boolean`, `object`), `format` (`phone` or null),
`required`, `editable`, `nullable`, `picklist` (a key of `picklists.json`, or null), `relation`
(null), and `vtiger` (`field`: vtiger's own name, null for a non-vtiger field; `block`;
`sequence` in the block; `maxLength`: the declared length). `withMockFields` turns an entry into
field metadata: `enum` from the picklist, `mock: true`, `custom: false`, `sortable` and
`searchable` false. The layout (which block, which row) is `src/lib/organization-layout.ts`.

| Name | Label | Type | Required | Block | vtiger | Why mock |
|---|---|---|---|---|---|---|
| modifiedAt | Modified Time | string | no | Organization Information | `modifiedtime` | the cube publishes no modification time |
| legalForm | Form | string, P1 | yes | Organization Information | `cf_658` | not in the cube yet |
| vatPayer | TVA | boolean | yes | Organization Information | `cf_665` | not in the cube yet |
| cui | CUI | string | yes | Organization Information | `cf_666` | not in the cube yet |
| tradeRegisterNo | Reg no | string | no | Organization Information | `cf_670` | not in the cube yet |
| customerCategory | Category | string, P7 | no | Organization Information | `cf_679` | not in the cube yet |
| assignedTo | Assigned To | object | yes | Organization Information | `assigned_user_id` | no user / group owner field in the cube |
| otherPhone | Other Phone | string (phone) | no | Organization Information | `otherphone` | not in the cube yet |
| mobilePhone | Comp Mobile Phone | string (phone) | no | Organization Information | `cf_677` | not in the cube yet |
| annualRevenue | Annual Revenue | integer | no | Organization Information | `annual_revenue` | not in the cube yet |
| fax | Fax | string (phone) | no | Organization Information | `fax` | not in the cube yet |
| caenCode | SIC Code | string | no | Organization Information | `siccode` | not in the cube yet |
| industrySpec | Industry Spec | string | no | Organization Information | `cf_703` | not in the cube yet |
| modifiedBy | Last Modified By | object | no | Organization Information | `modifiedby` | the cube publishes no last modifier |
| shippingStreet | Shipping Address | string | no | Address Information | `ship_street` | kept for deliveries (Bogdan, 2026-10-17), not in the cube |
| shippingCity | Shipping City | string | no | Address Information | `ship_city` | kept for deliveries (Bogdan, 2026-10-17), not in the cube |
| billingState | Billing State | string, P2 | yes | Address Information | `bill_state` | not in the cube; P2 with ISO codes (backend.md §12) |
| shippingState | Shipping State | string, P2 | no | Address Information | `ship_state` | kept for deliveries (Bogdan, 2026-10-17), not in the cube |
| shippingCode | Shipping Postal Code | string | no | Address Information | `ship_code` | kept for deliveries (Bogdan, 2026-10-17), not in the cube |
| shippingCountry | Shipping Country | string | no | Address Information | `ship_country` | kept for deliveries (Bogdan, 2026-10-17), not in the cube |
| billingSector | Billing Sector | integer | yes, for a Bucharest county | Address Information | – | new, not a vtiger field: invoicing's Bucharest sector (backend.md §12) |
| shippingSector | Shipping Sector | integer | no (Bucharest only) | Address Information | – | new, not a vtiger field: the billing sector's shape, optional |

<details>
<summary>fields.json, verbatim</summary>

```json
[
  {
    "name": "modifiedAt",
    "label": "Modified Time",
    "type": "string",
    "format": null,
    "required": false,
    "editable": false,
    "nullable": false,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "modifiedtime",
      "block": "Organization Information",
      "sequence": 2,
      "maxLength": null
    }
  },
  {
    "name": "legalForm",
    "label": "Form",
    "type": "string",
    "format": null,
    "required": true,
    "editable": true,
    "nullable": false,
    "picklist": "P1",
    "relation": null,
    "vtiger": {
      "field": "cf_658",
      "block": "Organization Information",
      "sequence": 9,
      "maxLength": 255
    }
  },
  {
    "name": "vatPayer",
    "label": "TVA",
    "type": "boolean",
    "format": null,
    "required": true,
    "editable": true,
    "nullable": false,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "cf_665",
      "block": "Organization Information",
      "sequence": 12,
      "maxLength": null
    }
  },
  {
    "name": "cui",
    "label": "CUI",
    "type": "string",
    "format": null,
    "required": true,
    "editable": true,
    "nullable": false,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "cf_666",
      "block": "Organization Information",
      "sequence": 14,
      "maxLength": 20
    }
  },
  {
    "name": "tradeRegisterNo",
    "label": "Reg no",
    "type": "string",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "cf_670",
      "block": "Organization Information",
      "sequence": 17,
      "maxLength": 20
    }
  },
  {
    "name": "customerCategory",
    "label": "Category",
    "type": "string",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": "P7",
    "relation": null,
    "vtiger": {
      "field": "cf_679",
      "block": "Organization Information",
      "sequence": 19,
      "maxLength": 255
    }
  },
  {
    "name": "assignedTo",
    "label": "Assigned To",
    "type": "object",
    "format": null,
    "required": true,
    "editable": true,
    "nullable": false,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "assigned_user_id",
      "block": "Organization Information",
      "sequence": 23,
      "maxLength": null
    }
  },
  {
    "name": "otherPhone",
    "label": "Other Phone",
    "type": "string",
    "format": "phone",
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "otherphone",
      "block": "Organization Information",
      "sequence": 27,
      "maxLength": 30
    }
  },
  {
    "name": "mobilePhone",
    "label": "Comp Mobile Phone",
    "type": "string",
    "format": "phone",
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "cf_677",
      "block": "Organization Information",
      "sequence": 30,
      "maxLength": 15
    }
  },
  {
    "name": "annualRevenue",
    "label": "Annual Revenue",
    "type": "integer",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "annual_revenue",
      "block": "Organization Information",
      "sequence": 32,
      "maxLength": null
    }
  },
  {
    "name": "fax",
    "label": "Fax",
    "type": "string",
    "format": "phone",
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "fax",
      "block": "Organization Information",
      "sequence": 33,
      "maxLength": 30
    }
  },
  {
    "name": "caenCode",
    "label": "SIC Code",
    "type": "string",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "siccode",
      "block": "Organization Information",
      "sequence": 36,
      "maxLength": 50
    }
  },
  {
    "name": "industrySpec",
    "label": "Industry Spec",
    "type": "string",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "cf_703",
      "block": "Organization Information",
      "sequence": 46,
      "maxLength": 50
    }
  },
  {
    "name": "modifiedBy",
    "label": "Last Modified By",
    "type": "object",
    "format": null,
    "required": false,
    "editable": false,
    "nullable": false,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "modifiedby",
      "block": "Organization Information",
      "sequence": 49,
      "maxLength": null
    }
  },
  {
    "name": "shippingStreet",
    "label": "Shipping Address",
    "type": "string",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "ship_street",
      "block": "Address Information",
      "sequence": 2,
      "maxLength": 250
    }
  },
  {
    "name": "shippingCity",
    "label": "Shipping City",
    "type": "string",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "ship_city",
      "block": "Address Information",
      "sequence": 6,
      "maxLength": 30
    }
  },
  {
    "name": "billingState",
    "label": "Billing State",
    "type": "string",
    "format": null,
    "required": true,
    "editable": true,
    "nullable": false,
    "picklist": "P2",
    "relation": null,
    "vtiger": {
      "field": "bill_state",
      "block": "Address Information",
      "sequence": 7,
      "maxLength": 30
    }
  },
  {
    "name": "shippingState",
    "label": "Shipping State",
    "type": "string",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": "P2",
    "relation": null,
    "vtiger": {
      "field": "ship_state",
      "block": "Address Information",
      "sequence": 8,
      "maxLength": 30
    }
  },
  {
    "name": "shippingCode",
    "label": "Shipping Postal Code",
    "type": "string",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "ship_code",
      "block": "Address Information",
      "sequence": 12,
      "maxLength": 30
    }
  },
  {
    "name": "shippingCountry",
    "label": "Shipping Country",
    "type": "string",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": "ship_country",
      "block": "Address Information",
      "sequence": 14,
      "maxLength": 30
    }
  },
  {
    "name": "billingSector",
    "label": "Billing Sector",
    "type": "integer",
    "format": null,
    "required": true,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": null,
      "block": "Address Information",
      "sequence": 15,
      "maxLength": null
    }
  },
  {
    "name": "shippingSector",
    "label": "Shipping Sector",
    "type": "integer",
    "format": null,
    "required": false,
    "editable": true,
    "nullable": true,
    "picklist": null,
    "relation": null,
    "vtiger": {
      "field": null,
      "block": "Address Information",
      "sequence": 16,
      "maxLength": null
    }
  }
]
```

</details>

## picklists.json

vtiger's picklists of the fields shown, complete, in the order vtiger shows them, read from the
vtiger database: values normalized, without "--None--" (stored as a real value in some fields;
organizations-ui-spec.md §5.3 has the counts). P6 (Other Industry), P8 (Bank) and P9 (Product
Category) went with their fields (under 15% filled) and are not here. Each entry is
`{field, label, values}`. P3, P4 and P5 serve real fields (Type, Industry, Company status)
until the backend publishes them as `enum` (`ORGANIZATION_ENUMS` in `organization-display.ts`).

| Key | Field | Label | Values | What |
|---|---|---|---|---|
| P1 | legalForm | Form | 29 | the legal form (SRL, SA, PFA...) |
| P2 | billingState | Billing State | 43 | the county; Shipping State takes the same list. The backend stores the ISO 3166-2:RO code (backend.md §12) |
| P3 | organizationType | Type | 12 | the organization type (Client potential, Client frecvent...) |
| P4 | industry | Industry | 123 | the industry, "Domain - Subdomain"; in vtiger role-based |
| P5 | rating | Rating | 9 | vtiger's Rating, which holds the company's legal status (UI label "Company status") |
| P7 | customerCategory | Category | 4 | the customer category |

<details>
<summary>picklists.json, verbatim</summary>

```json
{
  "P1": {
    "field": "legalForm",
    "label": "Form",
    "values": [
      "SCM",
      "SRL-D",
      "SAG",
      "SNC",
      "SCS",
      "SCA",
      "IF",
      "II",
      "RA",
      "fara",
      "CMI",
      "CMA",
      "CMG",
      "SM",
      "SCM1",
      "SCM2",
      "UC",
      "BNP",
      "BEJ",
      "CA",
      "CAA",
      "SCPA",
      "SPRL",
      "ASF",
      "CS",
      "PFA",
      "SA",
      "SRL",
      "Primarie"
    ]
  },
  "P2": {
    "field": "billingState",
    "label": "Billing State",
    "values": [
      "Alba",
      "Arad",
      "Arges",
      "Bacau",
      "Bihor",
      "Bistrita Nasaud",
      "Botosani",
      "Braila",
      "Bucuresti",
      "Brasov",
      "Buzau",
      "Calarasi",
      "Caras Severin",
      "Cluj",
      "Constanta",
      "Covasna",
      "Dambovita",
      "Dolj",
      "Galati",
      "Giurgiu",
      "Gorj",
      "Harghita",
      "Hunedoara",
      "Ialomita",
      "Iasi",
      "Ilfov",
      "Maramures",
      "Mehedinti",
      "Mures",
      "Neamt",
      "Olt",
      "Prahova",
      "Salaj",
      "Satu Mare",
      "Sibiu",
      "Suceava",
      "Teleorman",
      "Timis",
      "Tulcea",
      "Valcea",
      "Vaslui",
      "Vrancea",
      "CE"
    ]
  },
  "P3": {
    "field": "organizationType",
    "label": "Type",
    "values": [
      "Client potential",
      "Client ocazional",
      "Client frecvent",
      "Revanzator",
      "Integrator",
      "Partener",
      "Administratie",
      "Concurent",
      "Investitor",
      "Analist",
      "Media",
      "Altele"
    ]
  },
  "P4": {
    "field": "industry",
    "label": "Industry",
    "values": [
      "Administratie - Asistenta Sociala, Pensii, Somaj, Mediu, Case Sanatate",
      "Administratie - Finante Publice, Directii, Servicii, Vami, Altele",
      "Administratie - Guvern, Prefecturi, Ministere, Armata, Politie, Servicii",
      "Administratie locala - Primarii, Consilii locale, Altele",
      "Agrement - Cluburi, Cazinouri, Baruri, Centre recreative, Parcuri",
      "Agricultura - Asociatii si Ferme agricole",
      "Agricultura - Cresterea animalelor",
      "Agricultura - Cresterea pasarilor",
      "Agricultura - Gospodarii agricole individuale",
      "Agricultura - Horticultura, Plante de gradina",
      "Agricultura - Hrana pentru animale, Nutreturi",
      "Agricultura - Legumicultura, Sere",
      "Agricultura - Piscicultura",
      "Agricultura - Viticultura, Pomicultura",
      "Comert - Combustibili, Benzinarii",
      "Comert - Confectii Textile Pielarie",
      "Comert - Electronice, Electrocasnice",
      "Comert - Malluri, Supermaketuri, Baze aprovizionare",
      "Comert - Materiale de constructii, Chimice",
      "Comert - Mobila si decoratiuni interioare",
      "Comert - Produse alimentare",
      "Comert Specializat - Vehicule, Reprezentante, Piese de schimb",
      "Comert Specializat - Masini, Echipamente, Utilaje",
      "Comert Specializat - Scule, Unelte, Accesorii",
      "Comunicatii - Telefonie mobila, Radiocomunicatii",
      "Constructii - Amenajari exterioare, Peisagistica",
      "Constructii - Amenajari interioare si Reparatii",
      "Constructii - Civile, Industriale, Agricole",
      "Constructii - Constructii din lemn",
      "Constructii - Edilitare, Imbunatatiri Funciare, Drumuri si poduri",
      "Constructii - Hidroizolatii si etansari",
      "Constructii - Instalatii climatizare, ventilatie, filtrare",
      "Constructii - Instalatii electrice",
      "Constructii - Instalatii sanitare, termice, gaz",
      "Constructii - Parchete si pardoseli",
      "Constructii - Proiectare in constructii si instalatii",
      "Constructii - Tamplarie Lemn, PVC, Aluminiu",
      "Cultura - Biblioteci, Muzee, Librarii, Anticariat",
      "Cultura - Centre culturale, Galerii, Teatre, Cinematografe",
      "Educatie - Scoli si Licee",
      "Educatie - Universitati, Colegii, Academii, Centre perfectionare",
      "Finante - Banci, Societati asigurari,Societati Leasing",
      "Finante - Burse si Societati Valori Mobiliare, Case de schimb",
      "Finante - Fonduri Pensii si Fonduri Investitii",
      "Industria Lemnului - Gatere, Cherestea, Prefabricate din lemn",
      "Industria Lemnului - Mobilier edilitar",
      "Industria Lemnului - Mobilier, Articole din lemn",
      "Industrie Alimentara - Abatoare, Procesarea Carnii",
      "Industrie Alimentara - Alimente diverse",
      "Industrie Alimentara - Bauturi Alcoolice si Racoritoare",
      "Industrie Alimentara - Morarit si Panificatie",
      "Industrie Alimentara - Procesarea laptelui, Branzeturi",
      "Industrie Auto - Productie autovehicule, Accesorii, Piese de schimb",
      "Industrie Chimica - Combustibili, Derivate",
      "Industrie Chimica - Ingrasaminte si Altele",
      "Industrie Chimica - Lacuri si vopsele, Coloranti",
      "Industrie Chimica - Mase plastice",
      "Industrie Chimica - Produse chimice larg consum",
      "Industrie Electrotehnica - Productie Aparatura electrocasnica",
      "Industrie Electrotehnica - Productie Aparatura electronica",
      "Industrie Electrotehnica - Productie Materiale si Aparate electrice",
      "Industrie Energetica - Distributie energie electrica si termica",
      "Industrie Energetica - Energii neconventionale",
      "Industrie Energetica - Instalatii energetice",
      "Industrie Energetica - Productie si furnizare energie electrica si termica",
      "Industrie Energetica - Proiectare, Consultanta si Altele",
      "Industrie Mecanica - Constructii de masini",
      "Industrie Mecanica - Piese, Confectii metalice",
      "Industrie Mecanica - Santiere navale",
      "Industrie Metalurgica - Metalurgie, Turnatorii",
      "Industrie Metalurgica - Teava, Tabla, Derivate",
      "Juridic - Avocati, Executori, Lichidatori, Notari",
      "Juridic - Tribunale, Judecatorii, Curti",
      "Marketing - Consultanta, Sondaje, Analiza",
      "Materii prime - Balastiere, Ciment, Beton, Cariere",
      "Materii prime - Extractie minereuri, petrol, gaze, sare",
      "Materii prime - Materiale refolosibile si reciclarea deseurilor",
      "Media - Ziare, Reviste, Publicatii, Radio, TV",
      "Organizatii NGV - Asociatii si Cluburi sportive",
      "Organizatii NGV - Biserici, parohii, manastiri",
      "Organizatii NGV - Fundatii, Asociatii, Partide",
      "Organizatii NGV - Sindicate, Federatii, Asociatii profesionale, Artisti",
      "Publicitate - Productie publicitara, Agentii",
      "Sanatate - Cabinete medicale si stomatologice",
      "Sanatate - Farmacii, Spitale, Clinici, Ambulante",
      "Servicii - Diverse",
      "Servicii - Garaje, Vulcanizari, Spalatorii",
      "Servicii - Organizare evenimente, spectacole, altele",
      "Servicii - Reparatii, Ateliere, Amenajari",
      "Servicii - Transport, Case de expeditii",
      "Servicii Publice - Apa Canal",
      "Servicii Publice - Gaz, Electricitate, Termoficare",
      "Servicii Publice - Salubritate, Spatii verzi",
      "Servicii Publice - Transport public urban",
      "Silvicultura - Ocoale silvice, Exploatatii forestiere si pepiniere",
      "Sport - Centre, Sali sportive, Stadioane",
      "Turism - Hoteluri, Restaurante, Pensiuni",
      "Industrie Textila - Productie, Lohn",
      "Comert - Diverse",
      "Comert Specializat - Tehnica de calcul, birotica",
      "Industrie Chimica - Celuloza si hirtie",
      "Industrie Pielarie - Incaltaminte, Marochinarie",
      "Productie intelectuala - Cercetare, Software, Design",
      "Servicii - Agricultura, Silvicultura,Viticultura",
      "Productie artistica - Filme, Spectacole, Emisiuni TV",
      "Industrie Chimica - Produse farmaceutice",
      "Productie diversa - Jucarii, Instrumente muzicale, Bijuterii",
      "Servicii - Tiparire, Imprimare, Copiere, Inregistrare",
      "Industrie Textila - Fire, Fibre, Materiale",
      "Industrie Chimica - Sticla, Portelan, Caramizi, Ceramica, Alte materiale",
      "Industrie Pielarie - Procesare piele, Confectii din piele si blana",
      "Comunicatii - Cablu, Provideri Internet, CATV, altele",
      "Materii prime – Extractie minereuri, petrol, gaze, sare",
      "Materii prime – Balastiere, Ciment, Beton, Cariere",
      "Industrie Alimentara – Bauturi Alcoolice si Racoritoare",
      "Industrie Textila – Fire, Fibre, Materiale",
      "Industrie Textila – Productie, Lohn",
      "Industrie Pielarie – Procesare piele, Confectii din piele si blana",
      "Industrie Pielarie – Incaltaminte, Marochinarie",
      "Industrie Chimica – Produse farmaceutice",
      "Industrie Metalurgica – Metalurgie, Turnatorii",
      "Industrie Metalurgica – Teava, Tabla, Derivate",
      "Industrie Mecanica – Piese, Confectii metalice"
    ]
  },
  "P5": {
    "field": "rating",
    "label": "Rating",
    "values": [
      "Activ",
      "Inactiv",
      "Restrictionat",
      "Dizolvat/Radiat",
      "Lichidare",
      "Insolventa",
      "Restructurare",
      "Litigiu cu GT",
      "Tepar"
    ]
  },
  "P7": {
    "field": "customerCategory",
    "label": "Category",
    "values": [
      "Normal",
      "Silver",
      "Gold",
      "Platin"
    ]
  }
}
```

</details>

## organizations.json

The three demo organizations. Each carries every field the UI shows, published or mock, so the
detail, the form and the list can be reviewed with full data.

| Id | No | Name | Billing | Shipping | Demonstrates |
|---|---|---|---|---|---|
| org_mock_001 | ACC90001 | Exemplu Construct SRL | Bucuresti, Bucuresti, Sector 3 | Chiajna, Ilfov | Bucharest billing: Billing Sector shows (left), shipping elsewhere; two demo contacts |
| org_mock_002 | ACC90002 | Demo Instal Nord SA | Baia Mare, Maramures | Bucuresti, Bucuresti, Sector 6 | Bucharest shipping: Shipping Sector shows (right), the left cell empty; a group as owner; company status Insolventa |
| org_mock_003 | ACC90003 | Proba Agro Vest II | Lugoj, Timis | none | no shipping address: no Sector row; a non-VAT payer (II) |

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
    "billingCity": "Bucuresti",
    "billingState": "Bucuresti",
    "billingSector": 3,
    "billingCode": "030000",
    "billingCountry": "Romania",
    "shippingStreet": "Str. Depozitului nr. 2",
    "shippingCity": "Chiajna",
    "shippingState": "Ilfov",
    "shippingSector": null,
    "shippingCode": "077040",
    "shippingCountry": "Romania",
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
    "billingSector": null,
    "billingCode": "430000",
    "billingCountry": "Romania",
    "shippingStreet": "Sos. Livrarilor nr. 15",
    "shippingCity": "Bucuresti",
    "shippingState": "Bucuresti",
    "shippingSector": 6,
    "shippingCode": "060000",
    "shippingCountry": "Romania",
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
    "billingSector": null,
    "billingCode": null,
    "billingCountry": "Romania",
    "shippingStreet": null,
    "shippingCity": null,
    "shippingState": null,
    "shippingSector": null,
    "shippingCode": null,
    "shippingCountry": null,
    "description": "Interesat de motopompe pentru irigatii.",
    "createdAt": "2023-05-08T12:00:00Z",
    "modifiedAt": "2023-05-08T12:00:00Z",
    "modifiedBy": { "id": "u_mock_11", "name": "Agent Vanzari 3" }
  }
]
```

## contacts.json

The two made-up contacts of `org_mock_001` (Maria Proba, Ion Exemplu), for the Contacts related
list. Read-only, never from or to the backend, with no contact page.

```json
[
  {
    "id": "con_mock_001",
    "name": "Maria Proba",
    "email": "maria.proba@exemplu.test",
    "phone": "0700 000 012",
    "company": "Exemplu Construct SRL",
    "organizationId": "org_mock_001"
  },
  {
    "id": "con_mock_002",
    "name": "Ion Exemplu",
    "email": "ion.exemplu@exemplu.test",
    "phone": "0700 000 011",
    "company": "Exemplu Construct SRL",
    "organizationId": "org_mock_001"
  }
]
```

## Keeping this copy exact

While `src/mock/` exists, the JSON blocks above must equal the files. From the repository root:

```sh
python3 - <<'EOF'
import re
doc = open("docs/plan/organizations-mock-data.md").read()
blocks = re.findall(r"^## (\S+\.json)$.*?^```json\n(.*?)^```$", doc, re.S | re.M)
for name, body in blocks:
    same = open(f"frontend/src/mock/organizations/{name}").read() == body
    print(name, "identical" if same else "DIFFERENT")
EOF
```
