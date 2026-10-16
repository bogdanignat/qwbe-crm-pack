"use client"

// The create form, driven by the same cube metadata as the list and detail.
// The caller names the static fields to show -- the cube's basic
// set, not every editable field -- while labels, required flags,
// nullability and the relation picker come from the published metadata: no
// field label is hard-coded here, and a name the schema does not define (or
// does not accept on create) is dropped.
//
// Required CUSTOM fields are appended automatically, derived from the same
// metadata: on a stack whose custom-field definitions carry required flags
// (the vtiger mirror: form/tva/cui on organizations) the kernel refuses every
// create without them, so a basic form without them could not create a row at
// all. No management surface here -- attaching and hiding are the settings
// area's job (F2). Non-required customs WITH a default value (the settings
// preference, lib/field-prefs) join the form too, prefilled: a default that
// never reaches a row is dead UI. The control per field follows the metadata
// alone (renderKindOf, the same classifier the inline editor uses): an enum
// is a select, a boolean a checkbox, everything else a text input.
//
// Submit POSTs the filled fields through the server proxy (the token stays in
// the cookie) and lands on the new row's detail page; qwbe's own refusal
// message is shown on the form. The form logic that survives without a DOM
// (the payload build) lives in lib/cube.ts and is unit-tested there.

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  apiFetch,
  createPayloadOf,
  cubeApiPath,
  errorBody,
  errorMessage,
  metadataApiPath,
  renderKindOf,
  rowHref,
  routeOf,
  type CubeMetadata,
  type FieldMetadata,
  type Row,
  requestFailure,
} from "@/lib/cube"
import { withMockFields } from "@/mock/organizations"
import { withOrganizationLabels } from "@/lib/organization-labels"
import { readPrefs } from "@/lib/field-prefs"
import { RelationTypeahead } from "@/components/relation-typeahead"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

export function CubeCreateForm({
  cube,
  fields,
}: {
  cube: string
  // The static field names to show, in display order.
  fields: string[]
}) {
  const router = useRouter()
  const [meta, setMeta] = useState<CubeMetadata | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // The submit only exists once the client has hydrated: before that, typed
  // values sit in the DOM while React's state is still empty, and a submit
  // would send an empty payload (the same race the login form gates).
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setHydrated(true), 0)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    let alive = true
    apiFetch(metadataApiPath(cube))
      .then(async (r) => {
        if (!r.ok) throw await requestFailure("metadata", r)
        return withOrganizationLabels(withMockFields((await r.json()) as CubeMetadata))
      })
      .then((m) => {
        if (alive) setMeta(m)
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [cube])

  // The caller's order decides the display order of the static fields; only
  // fields the schema actually accepts on create are rendered. The required
  // custom fields follow (metadata order): the kernel refuses a create that
  // lacks them, so they are part of the create contract, not decoration.
  // Non-required customs carrying a settings default come last, prefilled.
  const [defaultedCustoms, setDefaultedCustoms] = useState<FieldMetadata[]>([])
  useEffect(() => {
    if (!meta) return
    // The deferred client-only read is this app's hydration pattern (the
    // hydrated gate below): localStorage exists only in the browser, and the
    // first render must agree with the server's.
    const t = setTimeout(() => {
      const { defaults } = readPrefs(cube)
      const carrying = meta.fields.filter((f) => f.custom && defaults[f.name])
      setDefaultedCustoms(carrying.filter((f) => !f.required))
      // A default prefills any custom field on the form -- required ones
      // included; what was typed already wins over the default.
      setValues((v) => {
        const next = { ...v }
        for (const f of carrying) if (!next[f.name]) next[f.name] = defaults[f.name]
        return next
      })
    }, 0)
    return () => clearTimeout(t)
  }, [meta, cube])

  const formFields = useMemo(() => {
    if (!meta) return []
    const statics = fields.flatMap((name) => {
      const field = meta.fields.find((f) => f.name === name && f.editable)
      return field ? [field] : []
    })
    const requiredCustoms = meta.fields.filter((f) => f.custom && f.required)
    return [...statics, ...requiredCustoms, ...defaultedCustoms]
  }, [meta, fields, defaultedCustoms])

  const setValue = (name: string, value: string) =>
    setValues((v) => ({ ...v, [name]: value }))

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const { payload, missing } = createPayloadOf(formFields, values)
    if (missing.length > 0) {
      setRefusal(`Required: ${missing.join(", ")}`)
      return
    }
    setRefusal(null)
    setPending(true)
    // Custom values ride at the top level; the kernel folds the declared keys
    // into the row's `custom` sub-object (the same fold the inline PATCH uses).
    const response = await apiFetch(cubeApiPath(cube), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    setPending(false)
    if (!response.ok) {
      // qwbe's message, matched to the payload it refused; the typed values
      // stay in the form so a fix does not start from zero.
      setRefusal(errorMessage(await errorBody(response)))
      return
    }
    const row = (await response.json()) as Row
    toast.success("Created")
    // The detail page shows what was actually stored; when this app has no
    // route for the cube, back to the list.
    router.push(rowHref(cube, String(row.id)) ?? routeOf(cube))
  }

  if (loadError) return <p role="alert">{loadError}</p>
  if (!meta) return <Skeleton className="h-64 w-full" />

  return (
    <Card className="w-full max-w-2xl">
      <CardContent>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            {formFields.map((f) => (
              <Field key={f.name}>
                {f.relation ? (
                  // The picker carries its own label (it is a combobox, not a
                  // plain input, so a htmlFor label would not reach it); the
                  // aria-label names the field in form mode.
                  <RelationTypeahead
                    field={f}
                    variant="form"
                    value={values[f.name] ?? ""}
                    onChange={(id) => setValue(f.name, id)}
                  />
                ) : renderKindOf(f) === "select" ? (
                  <>
                    <FieldLabel>{f.label}</FieldLabel>
                    {/* Radix forbids an empty-string SelectItem value, so an
                        untouched select simply shows no choice; a required
                        enum is caught client-side on submit. The optional-enum
                        clear item (the editor's "__clear__" sentinel) has no
                        occurrence yet: every enum that reaches this form is
                        required by construction. */}
                    <Select value={values[f.name] ?? ""} onValueChange={(v) => setValue(f.name, v)}>
                      <SelectTrigger className="w-64" aria-label={f.label}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {f.enum!.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : renderKindOf(f) === "checkbox" ? (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`create-${f.name}`}
                      aria-label={f.label}
                      checked={values[f.name] === "true"}
                      onCheckedChange={(checked) => setValue(f.name, checked ? "true" : "false")}
                    />
                    <FieldLabel htmlFor={`create-${f.name}`}>{f.label}</FieldLabel>
                  </div>
                ) : (
                  <>
                    <FieldLabel htmlFor={`create-${f.name}`}>{f.label}</FieldLabel>
                    {/* ponytail: every text form field so far is free text
                        (the two cubes' basic sets and the custom strings); if
                        a create set ever gains a number field, coerce in
                        lib/cube.ts already handles the value -- only a
                        type="number" input would be added here. */}
                    <Input
                      id={`create-${f.name}`}
                      value={values[f.name] ?? ""}
                      required={f.required}
                      onChange={(e) => setValue(f.name, e.target.value)}
                    />
                  </>
                )}
              </Field>
            ))}
            {refusal && (
              <p role="alert" className="text-sm text-destructive">
                {refusal}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending || !hydrated}>
                {pending ? "Saving..." : "Create"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
