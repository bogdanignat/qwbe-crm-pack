// The demo custom fields: structure mirrored from the real vtiger custom fields
// (field label + type + required, from vtiger_field; the two hidden "Cod import"
// markers -- presence=1 -- are left out). The TYPES are mapped from vtiger uitypes:
// 1 -> text, 7 -> number, 56 -> bool, 15 -> select, 11/13/17 -> text. Options are
// SYNTHETIC on purpose: the real picklist values are the customer's own taxonomy --
// data, not structure. Labels are the real ones, ASCII-folded.

export interface CustomField {
  readonly name: string
  readonly label: string
  readonly fieldType: "text" | "number" | "date" | "bool" | "select"
  readonly options: readonly string[]
  readonly required: boolean
}

export const ORGANIZATION_CUSTOM_FIELDS: readonly CustomField[] = [
  { name: "otherIndustry", label: "Other Industry", fieldType: "select", required: false, options: ["Services", "Retail", "Manufacturing", "Construction", "IT and Software", "Agriculture", "Transport", "Energy"] },
  { name: "form", label: "Form", fieldType: "select", required: true, options: ["SRL", "SRL-D", "PFA", "SA", "SNC", "RA"] },
  { name: "otherIndustrySpec", label: "Other Industry Spec", fieldType: "text", required: false, options: [] },
  { name: "tva", label: "TVA", fieldType: "bool", required: true, options: [] },
  { name: "cui", label: "CUI", fieldType: "text", required: true, options: [] },
  { name: "regNo", label: "Reg no", fieldType: "text", required: false, options: [] },
  { name: "category", label: "Category", fieldType: "select", required: false, options: ["Lead", "Active", "Preferred", "Past"] },
  { name: "bank", label: "Bank", fieldType: "select", required: false, options: ["Alpha Bank", "Beta Bank", "Gamma Bank", "Delta Bank", "Epsilon Bank"] },
  { name: "productCategory", label: "Product Category", fieldType: "select", required: false, options: ["Tools", "Machinery", "Electrical", "Services", "Spare parts"] },
  { name: "iban", label: "IBAN", fieldType: "text", required: false, options: [] },
  { name: "compMobilePhone", label: "Comp Mobile Phone", fieldType: "text", required: false, options: [] },
  { name: "otherFax", label: "Other Fax", fieldType: "text", required: false, options: [] },
  { name: "accountTurnover", label: "Account Turnover EUR", fieldType: "number", required: false, options: [] },
  { name: "industrySpec", label: "Industry Spec", fieldType: "text", required: false, options: [] },
]

export const CONTACT_CUSTOM_FIELDS: readonly CustomField[] = [
  { name: "socialNet", label: "Social Net", fieldType: "text", required: false, options: [] },
  { name: "skypeAcc", label: "Skype Acc", fieldType: "text", required: false, options: [] },
  { name: "cnp", label: "CNP", fieldType: "number", required: false, options: [] },
  { name: "website", label: "Website", fieldType: "text", required: false, options: [] },
  { name: "serieBuletin", label: "Serie buletin", fieldType: "text", required: false, options: [] },
  { name: "office", label: "Office", fieldType: "text", required: false, options: [] },
  { name: "numarBuletin", label: "Numar buletin", fieldType: "text", required: false, options: [] },
  { name: "title", label: "Title", fieldType: "select", required: false, options: ["Manager", "Director", "Specialist", "Technician"] },
  { name: "department", label: "Department", fieldType: "select", required: false, options: ["Sales", "Production", "Finance", "IT", "Logistics"] },
  { name: "compMobilePhone", label: "Comp Mobile Phone", fieldType: "text", required: false, options: [] },
  { name: "extensionOffice", label: "Extension Office", fieldType: "text", required: false, options: [] },
  { name: "homeEmail", label: "Home Email", fieldType: "text", required: false, options: [] },
  { name: "personalEmail", label: "Personal Email", fieldType: "text", required: false, options: [] },
]

/** The cubes that carry demo custom fields, with their definitions, in seeding order. */
export const DEF_CUBES = [
  ["crm/organizations", ORGANIZATION_CUSTOM_FIELDS],
  ["crm/contacts", CONTACT_CUSTOM_FIELDS],
] as const

export const COUNTS = { organizations: 50, contacts: 50, contracts: 5 }
/** Demo rows carry this externalId prefix; the wipe touches only prefixed rows. */
export const DEMO_PREFIX = "demo:"
