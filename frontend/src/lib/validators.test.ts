// The generic field check every cube form shares: required, maxLength, the
// email format and whole numbers, all from the published metadata.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { testField as field } from "./test-fields.ts"
import { editedFieldError, emailError, fieldError, integerError, maxLengthError, requiredError } from "./validators.ts"

describe("the single validators", () => {
  it("say what is wrong, or null", () => {
    assert.equal(requiredError("Organization Name", "  "), "Organization Name is required")
    assert.equal(requiredError("Organization Name", "x"), null)
    assert.equal(maxLengthError("Phone", "x".repeat(21), 20), "Phone can be at most 20 characters")
    assert.equal(maxLengthError("Phone", "x".repeat(20), 20), null)
    assert.equal(emailError("office@exemplu.test"), null)
    assert.match(emailError("office@exemplu") ?? "", /email address/)
    assert.equal(integerError("42"), null)
    assert.match(integerError("4.2") ?? "", /whole number/)
  })
})

describe("fieldError", () => {
  it("requires only what the metadata marks required, never a checkbox", () => {
    assert.equal(fieldError(field({ name: "name", label: "Organization Name", required: true }), " "), "Organization Name is required")
    assert.equal(fieldError(field({ name: "industry", label: "Industry", required: false }), ""), null)
    assert.equal(fieldError(field({ name: "vatPayer", type: "boolean", required: true }), false), null)
  })

  it("applies the email format, whole numbers and the published maxLength", () => {
    assert.match(fieldError(field({ name: "email", format: "email" }), "x@") ?? "", /email/)
    assert.match(fieldError(field({ name: "employees", type: "integer" }), "4,5") ?? "", /whole number/)
    assert.match(fieldError(field({ name: "phone", label: "Phone", maxLength: 5 }), "123456") ?? "", /at most 5/)
    assert.equal(fieldError(field({ name: "phone", maxLength: 5 }), "12345"), null)
  })

  it("has no rule by field name: a CUI is only text until the backend refuses it", () => {
    assert.equal(fieldError(field({ name: "cui", label: "CUI" }), "RO18547291"), null)
    assert.equal(fieldError(field({ name: "mobilePhone" }), "0".repeat(16)), null)
  })
})

describe("editedFieldError", () => {
  const name = field({ name: "name", label: "Name", required: true })
  const email = field({ name: "email", label: "Email", format: "email" })

  it("lets a value the record already held pass, even empty-required or invalid", () => {
    assert.equal(editedFieldError(name, "", ""), null)
    assert.equal(editedFieldError(name, "", null), null)
    assert.equal(editedFieldError(email, "legacy@", "legacy@ "), null)
  })

  it("checks a value the user changed", () => {
    assert.equal(editedFieldError(name, " ", "Acme"), "Name is required")
    assert.match(editedFieldError(email, "new@", "legacy@") ?? "", /email address/)
    assert.equal(editedFieldError(email, "ok@example.test", "legacy@"), null)
  })
})
