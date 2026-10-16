"use client"

// The custom-field management surface: lists the selected cube's current
// custom fields, and lets an
// ADMINISTRATOR add one (name, type, required, options for a select) or delete
// one -- no code, no redeploy. Definitions are served by the customfields cube
// through the same server-side proxy as everything else; the token never
// leaves the httpOnly cookie.
//
// The panel is visible ONLY to a user whose effective permissions include
// customfields:write (qwbe's /auth/me publishes them); anyone else gets the
// message, not a silent blank section. A direct call to the definition
// endpoints answers 403 from qwbe -- the message shown here is qwbe's own.

import { useCallback, useEffect, useState } from "react"

import {
  apiFetch,
  canDefineFields,
  errorBody,
  errorMessage,
  httpPrefixOf,
  type Row,
} from "@/lib/cube"
import {
  EMPTY_PREFS,
  readPrefs,
  writePrefs,
  withDefault,
  withHidden,
  type CustomFieldPrefs,
} from "@/lib/field-prefs"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useCurrentUser } from "@/hooks/use-current-user"

// The definition types the customfields pack accepts. NOT restated here as a
// frozen copy: the pack publishes them in its OpenAPI document (the create
// schema's fieldType literal union), read at first open. The fallback list is
// only what the panel shows when that document cannot be read.
const FIELD_TYPES_FALLBACK = ["text", "number", "date", "bool", "select"]

// One fetch, one parse, shared by every panel on the page.
let openApiTypes: Promise<string[]> | null = null
const acceptedFieldTypes = (): Promise<string[]> => {
  openApiTypes ??= apiFetch("/api/qwbe/openapi.json")
    .then(async (r) => {
      if (!r.ok) throw new Error(`openapi request failed: ${r.status}`)
      const spec = (await r.json()) as {
        components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> }
      }
      const ft = spec.components?.schemas?.CustomFieldCreate?.properties?.fieldType as
        | { enum?: unknown; anyOf?: { const?: unknown }[]; oneOf?: { const?: unknown }[] }
        | undefined
      const fromEnum = Array.isArray(ft?.enum) ? (ft?.enum as unknown[]).map(String) : []
      const fromAnyOf = (ft?.anyOf ?? []).map((x) => String(x.const)).filter(Boolean)
      const fromOneOf = (ft?.oneOf ?? []).map((x) => String(x.const)).filter(Boolean)
      const types = fromEnum.length > 0 ? fromEnum : fromAnyOf.length > 0 ? fromAnyOf : fromOneOf
      if (types.length === 0) throw new Error("openapi publishes no fieldType enum")
      return types
    })
    .catch(() => FIELD_TYPES_FALLBACK)
  return openApiTypes
}

// One definition as the customfields list endpoint returns it (a row of the
// pack's own table; deleted definitions are soft-deleted and filtered here).
export type CustomFieldDef = {
  id: string
  targetCube: string
  name: string
  label: string
  fieldType: string
  options: string[]
  required: boolean
  deleted: boolean
}

export function CustomFieldsPanel({
  cube,
}: {
  // The full cube name the definitions target, e.g. "crm/contacts".
  cube: string
}) {
  const [fieldTypes, setFieldTypes] = useState<string[] | null>(null)
  const [defs, setDefs] = useState<CustomFieldDef[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The per-browser UI layer (lib/field-prefs): which fields this browser
  // hides from the lists and what a create form prefills. NOT server state --
  // the definition itself is what the API owns; see field-prefs.ts for why.
  // Read in an effect, so the server render and the first client render agree
  // (no hydration mismatch) and a cube switch re-reads its own document.
  const [prefs, setPrefs] = useState<CustomFieldPrefs>(EMPTY_PREFS)
  useEffect(() => {
    // The deferred read is the codebase's hydration pattern (the hydrated
    // gate below uses the same timer): localStorage exists only on the
    // client, and the first render must agree with the server's.
    const t = setTimeout(() => setPrefs(readPrefs(cube)), 0)
    return () => clearTimeout(t)
  }, [cube])
  const changePrefs = (next: CustomFieldPrefs) => {
    writePrefs(cube, next)
    setPrefs(next)
  }

  // Permission check first: without customfields:write this component renders
  // the message instead of management UI; an identity that cannot be read is
  // "no permission". Read per mount, never cached: a cached failure would pin
  // "no permission" for the whole SPA lifetime (QWB-60).
  const me = useCurrentUser()
  const allowed = me.status === "loading" ? null : canDefineFields(me.user?.permissions ?? [])

  // The accepted types come from the pack's own published schema, once.
  useEffect(() => {
    let alive = true
    acceptedFieldTypes().then((types) => {
      if (alive) setFieldTypes(types)
    })
    return () => {
      alive = false
    }
  }, [])

  const loadDefs = useCallback(() => {
    let alive = true
    const stop = () => {
      alive = false
    }
    apiFetch(`/api/qwbe/customfields?cube=${encodeURIComponent(cube)}&limit=200`)
      .then(async (r) => {
        if (!r.ok) throw new Error(errorMessage(await errorBody(r)))
        return (await r.json()) as { rows?: CustomFieldDef[] }
      })
      .then((p) => {
        if (!alive) return
        // A stale error from another cube (or a failed earlier load) must not
        // outlive the reload that replaces it. Cleared on the response, not
        // synchronously: this runs from an effect too, and a synchronous
        // set-state there is what react-hooks/set-state-in-effect forbids.
        setError(null)
        setDefs((p.rows ?? []).filter((d) => d.deleted === false && d.targetCube === cube))
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return stop
  }, [cube])

  // The cleanup is returned for real: an unmount while the list is in flight
  // must not set state on a dead component.
  useEffect(() => loadDefs(), [loadDefs])

  if (allowed === null) return <Skeleton className="h-40 w-full" aria-label="Loading" />
  if (!allowed)
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Custom fields are managed with the customfields:write permission, which
            this account does not have.
          </p>
        </CardContent>
      </Card>
    )

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Custom fields</CardTitle>
          <CardDescription>
            Fields defined at runtime for this entity. They appear in the list,
            the detail page and inline edit as soon as they are defined.
            &quot;Hidden on lists&quot; and &quot;Default value&quot; are
            preferences of this browser only, not part of the definition.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* The Table wrapper scrolls horizontally on its own and the Card
              clips overflow, so a wide table never widens the page. */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Hidden on lists</TableHead>
                <TableHead>Default value</TableHead>
                <TableHead>Options</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(defs ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.label || d.name}</TableCell>
                  <TableCell>{d.fieldType}</TableCell>
                  <TableCell>{d.required ? "yes" : "no"}</TableCell>
                  <TableCell>
                    {/* hide != delete (F2): the definition and every stored
                        value stay; this browser just drops the field from
                        the list columns. */}
                    <Checkbox
                      aria-label={`Hide ${d.label || d.name} on lists`}
                      checked={prefs.hidden.includes(d.name)}
                      onCheckedChange={(checked) =>
                        changePrefs(withHidden(prefs, d.name, checked === true))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <DefaultValueEditor
                      def={d}
                      value={prefs.defaults[d.name] ?? ""}
                      onChange={(v) => changePrefs(withDefault(prefs, d.name, v))}
                    />
                  </TableCell>
                  <TableCell
                    className="max-w-xs truncate"
                    title={d.options.length > 0 ? d.options.join(", ") : undefined}
                  >
                    {d.options.length > 0 ? d.options.join(", ") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      id={d.id}
                      name={d.label || d.name}
                      cube={cube}
                      fieldName={d.name}
                      onDeleted={() => loadDefs()}
                      onError={setError}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {defs === null && !error && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              )}
              {defs !== null && defs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No custom fields defined.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Add a field</CardTitle>
          <CardDescription>
            The name is the key stored on every row; the label is what users
            see. A select needs its options, comma-separated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DefineForm
            cube={cube}
            fieldTypes={fieldTypes ?? FIELD_TYPES_FALLBACK}
            onDefined={() => loadDefs()}
            onError={setError}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function DeleteButton({
  id,
  name,
  cube,
  fieldName,
  onDeleted,
  onError,
}: {
  id: string
  name: string
  cube: string
  fieldName: string
  onDeleted: () => void
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  // Deleting a definition is irreversible from this UI and orphans every
  // stored value, so the first click only SCANS and asks: how many rows in
  // the first 200 of the target carry a value, which this delete would leave
  // behind as orphans (the pack's orphan report surfaces them afterwards).
  // "unknown" = the scan itself failed; the user is told so rather than shown
  // a reassuring zero.
  // ponytail: qwbe caps every list at 200 rows (kernel MAX_LIMIT) and has no
  // filter or count on custom keys, so a full orphan count needs a backend
  // slice (a `custom.<key>` presence filter or a count route). Until then the
  // message carries the cube total next to the partial count, so a 60k-row
  // cube never reads as fully scanned.
  const [confirming, setConfirming] = useState<
    { carrying: number; scanned: number; total: number | undefined } | "unknown" | null
  >(null)
  const beginConfirm = async () => {
    setBusy(true)
    try {
      const r = await apiFetch(`/api/qwbe/${httpPrefixOf(cube)}?limit=200`)
      if (!r.ok) {
        setConfirming("unknown")
        return
      }
      const p = (await r.json()) as { rows?: Row[]; total?: number }
      const rows = p.rows ?? []
      const carrying = rows.filter((row) => {
        const custom = row.custom
        const v = custom && typeof custom === "object" ? (custom as Row)[fieldName] : undefined
        return v !== undefined && v !== null && v !== ""
      }).length
      setConfirming({ carrying, scanned: rows.length, total: p.total })
    } catch {
      setConfirming("unknown")
    } finally {
      setBusy(false)
    }
  }
  if (confirming !== null) {
    return (
      <span className="flex flex-wrap items-center justify-end gap-1">
        <span className="text-xs text-muted-foreground">
          {confirming === "unknown"
            ? "Could not count rows carrying a value; any that do become orphans."
            : confirming.total !== undefined && confirming.total > confirming.scanned
              ? `${confirming.carrying} of the first ${confirming.scanned} row(s) carry a value; ${confirming.total - confirming.scanned} more row(s) were not scanned. Every value becomes an orphan.`
              : `${confirming.carrying} of ${confirming.scanned} row(s) carry a value; they become orphans.`}
        </span>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          aria-label={`Confirm delete ${name}`}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await apiFetch(`/api/qwbe/customfields/${encodeURIComponent(id)}`, {
                method: "DELETE",
              })
              if (!r.ok) {
                onError(errorMessage(await errorBody(r)))
                setConfirming(null)
              } else {
                setConfirming(null)
                onDeleted()
              }
            } finally {
              setBusy(false)
            }
          }}
        >
          Confirm delete
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={`Cancel delete ${name}`}
          onClick={() => setConfirming(null)}
        >
          Cancel
        </Button>
      </span>
    )
  }
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={busy}
      aria-label={`Delete ${name}`}
      onClick={beginConfirm}
    >
      Delete
    </Button>
  )
}

// The default-value editor for one definition, shaped by the field's own type:
// a choice for `select` (its options) and `bool` (true/false), a text input for
// everything else. "No default" is the empty value, which removes the
// preference entirely. The stored string is exactly what a form field holds;
// the create form applies it through the same coerce() a typed value goes
// through, so the kernel's own validation stays the only validator.
function DefaultValueEditor({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef
  value: string
  onChange: (value: string) => void
}) {
  // Radix forbids an empty-string SelectItem value; the empty choice rides on
  // a sentinel and is translated back to "" (no default) on change.
  const NONE = "__none__"
  const choices =
    def.fieldType === "select"
      ? def.options
      : def.fieldType === "bool"
        ? ["true", "false"]
        : null
  if (!choices) {
    return (
      <Input
        className="w-40"
        aria-label={`Default for ${def.label || def.name}`}
        value={value}
        placeholder="no default"
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <Select value={value === "" ? NONE : value} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger className="w-40" aria-label={`Default for ${def.label || def.name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No default</SelectItem>
        {choices.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// The add form. Everything it sends is what the customfields pack's create
// schema accepts; a refusal (bad name, select without options, duplicate,
// no permission) is answered with qwbe's own message.
function DefineForm({
  cube,
  fieldTypes,
  onDefined,
  onError,
}: {
  cube: string
  fieldTypes: string[]
  onDefined: () => void
  onError: (message: string) => void
}) {
  const [name, setName] = useState("")
  const [label, setLabel] = useState("")
  const [fieldType, setFieldType] = useState<string>("text")
  const [required, setRequired] = useState(false)
  const [options, setOptions] = useState("")
  const [busy, setBusy] = useState(false)

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          const r = await apiFetch("/api/qwbe/customfields", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              targetCube: cube,
              name,
              label,
              fieldType,
              required,
              options:
                fieldType === "select"
                  ? options
                      .split(",")
                      .map((o) => o.trim())
                      .filter((o) => o.length > 0)
                  : [],
            }),
          })
          if (!r.ok) {
            onError(errorMessage(await errorBody(r)))
          } else {
            setName("")
            setLabel("")
            setFieldType("text")
            setRequired(false)
            setOptions("")
            onDefined()
          }
        } finally {
          setBusy(false)
        }
      }}
    >
      {/* Field is w-full by design; the width classes keep the row's
          wrap layout, so the form stays one line on a wide screen. */}
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-48">
          <FieldLabel htmlFor="cf-name">Name</FieldLabel>
          <Input
            id="cf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. lead_source"
            required
          />
        </Field>
        <Field className="w-48">
          <FieldLabel htmlFor="cf-label">Label</FieldLabel>
          <Input
            id="cf-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="optional"
          />
        </Field>
        <Field className="w-32">
          <FieldLabel htmlFor="cf-type">Type</FieldLabel>
          <Select value={fieldType} onValueChange={setFieldType}>
            <SelectTrigger id="cf-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fieldTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {fieldType === "select" && (
          <Field className="w-64">
            <FieldLabel htmlFor="cf-options">Options (comma-separated)</FieldLabel>
            <Input
              id="cf-options"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder="email, phone"
              required
            />
          </Field>
        )}
        <Field orientation="horizontal" className="w-auto pb-2">
          <Checkbox
            id="cf-required"
            checked={required}
            onCheckedChange={(c) => setRequired(c === true)}
          />
          <FieldLabel htmlFor="cf-required">Required</FieldLabel>
        </Field>
        <Button type="submit" size="sm" disabled={busy} className="mb-0.5">
          Add field
        </Button>
      </div>
    </form>
  )
}
