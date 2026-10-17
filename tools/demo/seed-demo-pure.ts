// The generator: pure functions of the row index. No Math.random, no clock --
// the same seed produces the same sandbox (owner requirement: idempotent reruns).
import { CONTACT_CUSTOM_FIELDS, COUNTS, DEMO_PREFIX, ORGANIZATION_CUSTOM_FIELDS } from "./seed-demo-fields.ts"

const FIRST = ["Andrei", "Mihai", "Ionut", "Elena", "Ana", "Maria", "Cristina", "Vlad", "Sorin", "Diana"]
const LAST = ["Popescu", "Ionescu", "Popa", "Dumitrescu", "Stan", "Marin", "Radu", "Gheorghiu", "Iliescu", "Constantin", "Barbu", "Neagu"]
const COMPANY1 = ["Nord", "Delta", "Valea", "Corola", "Urban", "Terra", "Solar", "Metal", "Silvania", "Prima"]
const COMPANY2 = ["Construct", "Systems", "Import", "Group", "Partners", "Logistics", "Energy", "Tools", "Design", "Foods", "Consulting", "Solutions"]
const LEGAL = ["SRL", "SRL-D", "PFA", "SA", "SNC"]
const CITIES = ["Iasi", "Cluj", "Sibiu", "Brasov", "Timisoara", "Oradea", "Bacau", "Suceava"]
const INDUSTRY = ["manufacturing", "construction", "retail", "services", "it", "agriculture", "transport", "energy"]
const RATING = ["active", "prospect", "past"]
const OWNERSHIP = ["private", "public", "family"]
const SIGNED_AT = ["2026-01-15T10:00:00Z", "2026-02-20T09:30:00Z", "2026-03-10T14:00:00Z", "2026-04-02T11:15:00Z"]

const cycle = <A>(list: readonly A[], i: number, step: number): A => list[(i * step) % list.length]!
const pad = (n: number, width: number): string => String(n).padStart(width, "0")
const optionsOf = (fields: typeof ORGANIZATION_CUSTOM_FIELDS, index: number) => fields[index]!.options

/** 1..n, the row indexes of a demo set. */
export const indexes = (n: number): ReadonlyArray<number> => Array.from({ length: n }, (_, k) => k + 1)

/** The create payload of demo organization `i` (1-based): static fields plus custom keys. */
export const organizationRow = (i: number) => ({
  externalId: `${DEMO_PREFIX}organization:${i}`,
  name: `${cycle(COMPANY1, i, 7)} ${cycle(COMPANY2, i, 13)} ${LEGAL[i % LEGAL.length]}`,
  organizationNo: `ORG-2026-${pad(i, 4)}`,
  phone: `+40 264 ${pad(400 + (i % 500), 3)} ${pad(100 + i, 3)}`,
  email: `office${i}@example.test`,
  website: `https://demo-org-${i}.example.test`,
  organizationType: LEGAL[i % LEGAL.length],
  industry: INDUSTRY[i % INDUSTRY.length],
  rating: RATING[i % RATING.length],
  ownership: OWNERSHIP[i % OWNERSHIP.length],
  employees: (i * 17) % 250,
  emailOptOut: i % 7 === 0,
  billingStreet: `Str. Demo nr. ${i}`,
  billingCity: CITIES[i % CITIES.length],
  billingCode: String(100000 + i * 211),
  billingCountry: "Romania",
  description: `Demo organization ${i} - generated dummy data.`,
  // The custom keys ride at the top level: the kernel folds them into `custom`.
  otherIndustry: cycle(optionsOf(ORGANIZATION_CUSTOM_FIELDS, 0), i, 11),
  form: cycle(optionsOf(ORGANIZATION_CUSTOM_FIELDS, 1), i, 3),
  otherIndustrySpec: `Spec ${cycle(COMPANY2, i, 5).toLowerCase()}`,
  tva: i % 3 !== 0,
  cui: `RO${10000000 + i * 137}`,
  regNo: `J${1 + (i % 40)}/${100 + i}/2023`,
  category: cycle(optionsOf(ORGANIZATION_CUSTOM_FIELDS, 6), i, 7),
  bank: cycle(optionsOf(ORGANIZATION_CUSTOM_FIELDS, 7), i, 13),
  productCategory: cycle(optionsOf(ORGANIZATION_CUSTOM_FIELDS, 8), i, 3),
  iban: `RO${20 + (i % 79)}DEMO0000${pad(i, 4)}`,
  compMobilePhone: `+40 72${pad((i * 101) % 1000000, 6)}`,
  otherFax: `+40 31 ${pad(500 + i, 3)} ${pad(100 + i, 3)}`,
  accountTurnover: 1000 + ((i * 7919) % 499000),
  industrySpec: `Spec ${cycle(COMPANY1, i, 3).toLowerCase()}`,
})

/** The create payload of demo contact `i`, linked 1:1 to organization `i`. */
export const contactRow = (i: number) => {
  const name = `${cycle(FIRST, i, 7)} ${cycle(LAST, i, 13)}`
  return {
    externalId: `${DEMO_PREFIX}contact:${i}`,
    name,
    email: `${name.toLowerCase().replace(/ /g, ".")}@example.test`,
    phone: `+40 74${pad((i * 211) % 1000000, 6)}`,
    company: organizationRow(i).name,
    organizationExternalId: `${DEMO_PREFIX}organization:${i}`,
    custom: {
      socialNet: `https://social.example.test/demo${i}`,
      skypeAcc: `demo.skype.${i}`,
      cnp: 5000000000000 + i * 13,
      website: `https://demo-${i}.example.test`,
      serieBuletin: `R${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 7) % 26))}`,
      office: `Office ${1 + (i % 12)}`,
      numarBuletin: String(100000 + i * 13),
      title: cycle(optionsOf(CONTACT_CUSTOM_FIELDS, 7), i, 7),
      department: cycle(optionsOf(CONTACT_CUSTOM_FIELDS, 8), i, 3),
      compMobilePhone: `+40 72${pad((i * 57) % 1000000, 6)}`,
      extensionOffice: String(100 + i),
      homeEmail: `home${i}@example.test`,
      personalEmail: `personal${i}@example.test`,
    },
  }
}

/** The create payload of demo contract `j` (1-based), party = organization j*10. */
export const contractRow = (j: number) => ({
  title: `Maintenance 2026 - ${organizationRow(j * 10).name}`,
  amount: (250 + j * 137) * 100,
  currency: j % 2 === 0 ? "EUR" : "RON",
  signedAt: j <= SIGNED_AT.length ? SIGNED_AT[j - 1]! : null,
  partyExternalId: `${DEMO_PREFIX}organization:${j * 10}`,
})

/** The five deterministic demo contract titles -- the wipe finds demo contracts by them
 *  (the contracts cube has no externalId field to mark rows with). */
export const demoContractTitles = () => indexes(COUNTS.contracts).map((j) => contractRow(j).title)
