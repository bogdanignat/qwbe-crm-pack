// The organization form's client checks (spec §4.2, §4.3): CUI, IBAN, email,
// whole numbers, lengths and the required fields, by field name and format.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { cuiError } from "./cui.ts"
import { ibanError } from "./iban.ts"
import { isRequiredField, organizationFieldError } from "./organization-validation.ts"
import { testField as field } from "./test-fields.ts"
import { emailError, integerError, maxLengthError, requiredError } from "./validators.ts"

describe("cuiError", () => {
  it("accepts a CUI whose check digit matches the key 753217532", () => {
    for (const cui of ["18547290", "14399840", "1590082", "1234567897", " 18547290 ", ""]) assert.equal(cuiError(cui), null, cui)
  })

  it("refuses the RO prefix with a hint, letters, a wrong length and a wrong check digit", () => {
    assert.match(cuiError("RO18547290") ?? "", /without the RO prefix/)
    assert.match(cuiError("ro18547290") ?? "", /without the RO prefix/)
    assert.match(cuiError("1854729A") ?? "", /digits only/)
    assert.match(cuiError("12345678901") ?? "", /2 to 10 digits/)
    assert.match(cuiError("4") ?? "", /2 to 10 digits/)
    assert.match(cuiError("18547291") ?? "", /check digit/)
  })
})

describe("ibanError", () => {
  it("accepts a Romanian IBAN with a valid mod-97 checksum, spaced or lower case", () => {
    for (const iban of ["RO49AAAA1B31007593840000", "ro49 aaaa 1b31 0075 9384 0000", ""]) assert.equal(ibanError(iban), null, iban)
  })

  it("refuses another format and a wrong checksum", () => {
    assert.match(ibanError("DE89370400440532013000") ?? "", /Romanian IBAN/)
    assert.match(ibanError("RO49AAAA1B3100759384000") ?? "", /Romanian IBAN/)
    assert.match(ibanError("RO49AAAA1B31007593840001") ?? "", /check digits/)
  })
})

describe("the shared validators", () => {
  it("say what is wrong, or null", () => {
    assert.equal(requiredError("Organization Name", "  "), "Organization Name is required")
    assert.equal(requiredError("Organization Name", "x"), null)
    assert.equal(maxLengthError("CUI", "x".repeat(21), 20), "CUI can be at most 20 characters")
    assert.equal(maxLengthError("CUI", "x".repeat(20), 20), null)
    assert.equal(emailError("office@exemplu.test"), null)
    assert.match(emailError("office@exemplu") ?? "", /email address/)
    assert.equal(integerError("42"), null)
    assert.match(integerError("4.2") ?? "", /whole number/)
  })
})

describe("organizationFieldError", () => {
  it("requires vtiger's mandatory fields even when the metadata does not, never a checkbox", () => {
    assert.equal(isRequiredField(field({ name: "industry", required: false })), true)
    assert.equal(organizationFieldError(field({ name: "industry", label: "Industry" }), ""), "Industry is required")
    assert.equal(organizationFieldError(field({ name: "vatPayer", type: "boolean" }), false), null)
    assert.equal(organizationFieldError(field({ name: "phone" }), ""), null)
  })

  it("applies the CUI, IBAN, email and number rules by name, format and type", () => {
    assert.match(organizationFieldError(field({ name: "cui", label: "CUI" }), "RO1") ?? "", /RO prefix/)
    assert.match(organizationFieldError(field({ name: "iban" }), "RO00") ?? "", /Romanian IBAN/)
    assert.match(organizationFieldError(field({ name: "otherEmail", format: "email" }), "x@") ?? "", /email/)
    assert.match(organizationFieldError(field({ name: "website", format: "email" }), "x@") ?? "", /email/)
    assert.match(organizationFieldError(field({ name: "employees", type: "integer" }), "4,5") ?? "", /whole number/)
  })

  it("takes the length from the metadata first, else from vtiger's declared one", () => {
    assert.match(organizationFieldError(field({ name: "mobilePhone", label: "Comp Mobile Phone" }), "0".repeat(16)) ?? "", /at most 15/)
    assert.equal(organizationFieldError(field({ name: "mobilePhone", maxLength: 30 }), "0".repeat(16)), null)
    assert.match(organizationFieldError(field({ name: "phone", label: "Phone", maxLength: 5 }), "123456") ?? "", /at most 5/)
  })
})
