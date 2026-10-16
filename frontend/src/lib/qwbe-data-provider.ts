// The ra-core data provider over the qwbe proxy (QWB-53 / QWB-54, merged).
//
// The shadcn-admin-kit components talk to ra-core's DataProvider contract; the
// renderer pages live inside a scoped CoreAdminContext carrying this provider.
// Every call goes through the injected fetch -- in the app that is apiFetch,
// the same-origin proxy call that keeps the token in its httpOnly cookie, so
// no browser token ever appears here. Response and error shapes are qwbe's
// own: PageOf for lists, `{message, issues}` bodies for refusals.
//
// A refusal becomes ra-core's HttpError: its message is qwbe's own text and its
// body.errors maps each qwbe issue to the field it names -- the contract the
// kit's forms read to put a message under the input (QWB-53).

import {
  HttpError,
  type CreateParams,
  type CreateResult,
  type DataProvider,
  type DeleteManyResult,
  type DeleteResult,
  type GetListParams,
  type GetListResult,
  type GetManyParams,
  type GetManyReferenceResult,
  type GetManyResult,
  type GetOneParams,
  type GetOneResult,
  type RaRecord,
  type UpdateManyResult,
  type UpdateParams,
  type UpdateResult,
} from "ra-core"

import {
  cubeApiPath,
  errorBody,
  errorMessage,
  listApiPath,
  type ListParams,
  type PageOf,
  type Row,
} from "./cube.ts"
import { demoOrganizationOf } from "../mock/organizations/index.ts"

// ra-core's default sort is the record id; qwbe sorts only on the fields its
// metadata marks sortable, and a request without sortBy is accepted (the same
// shape the relation typeahead sends). So an "id" sort maps to no sort at all.
function sortOf(sort: { field: string; order: string } | undefined): Partial<ListParams> {
  if (!sort?.field || sort.field === "id") return {}
  return { sortBy: sort.field, descending: sort.order === "DESC" }
}

function filtersOf(filter: Record<string, unknown>): Record<string, string> {
  const filters: Record<string, string> = {}
  for (const [key, value] of Object.entries(filter ?? {})) {
    if (value === undefined || value === null) continue
    filters[key] = String(value)
  }
  return filters
}

// ra-core's own filter is `{q: searchText}` (the kit's AutocompleteInput
// default filterToQuery). `q` is a reserved list key, so it must travel as
// qwbe's `q` search, never as a bare field filter -- listQueryString would
// otherwise drop it and the relation picker would never narrow (QWB-53 review).
function searchOf(filter: Record<string, unknown>): { q?: string } {
  const q = filter?.q
  return typeof q === "string" && q !== "" ? { q } : {}
}

// The single path a cube serves one row at. The id is a path segment, so it is
// percent-encoded (cube ids carry no slash today; the encoding is the
// boundary's job, not an assumption about the id format).
function rowApiPath(cube: string, id: RaRecord["id"]): string {
  return cubeApiPath(cube, `/${encodeURIComponent(String(id))}`)
}

// body.errors as ra-core expects it: field name -> message, from qwbe's
// per-field issues. An issue without a string path is not a field error.
export function fieldErrorsOf(body: unknown): Record<string, string> {
  const errors: Record<string, string> = {}
  const issues = (body as { issues?: unknown } | null)?.issues
  if (!Array.isArray(issues)) return errors
  for (const issue of issues) {
    const path = (issue as { path?: unknown[] })?.path
    const message = (issue as { message?: unknown })?.message
    if (Array.isArray(path) && typeof path[0] === "string" && typeof message === "string") {
      errors[path[0]] ??= message
    }
  }
  return errors
}

async function refusal(response: Response): Promise<HttpError> {
  // qwbe's own message wins; a non-JSON body must not lose the text.
  const body = await errorBody(response)
  return new HttpError(errorMessage(body), response.status, { errors: fieldErrorsOf(body) })
}

// The factory takes the fetch so the tests can stub qwbe at the HTTP boundary;
// the app passes apiFetch. Rows keep qwbe's own shape (Record<string, unknown>
// with a string id); the generic RecordType assertions are the contract seam.
export function qwbeDataProvider(doFetch: typeof fetch): DataProvider {
  const readJson = async (url: string): Promise<unknown> => {
    const response = await doFetch(url)
    if (!response.ok) throw await refusal(response)
    return (await response.json()) as unknown
  }

  return {
    getList: async <RecordType extends RaRecord = RaRecord>(
      cube: string,
      { pagination, sort, filter }: GetListParams,
    ): Promise<GetListResult<RecordType>> => {
      const page = pagination?.page ?? 1
      const perPage = pagination?.perPage ?? 25
      const response = (await readJson(
        listApiPath(cube, {
          offset: (page - 1) * perPage,
          limit: perPage,
          ...sortOf(sort),
          ...searchOf(filter),
          filters: filtersOf(filter),
        }),
      )) as PageOf<Row>
      return { data: response.rows as RecordType[], total: response.total }
    },

    // A demo organization (mockup layer) opens from the mock, never from qwbe.
    getOne: async <RecordType extends RaRecord = RaRecord>(
      cube: string,
      { id }: GetOneParams<RecordType>,
    ): Promise<GetOneResult<RecordType>> => ({
      data: (demoOrganizationOf(cube, String(id)) ?? (await readJson(rowApiPath(cube, id)))) as RecordType,
    }),

    // The batch read the kit's reference fields resolve titles with: qwbe's
    // `ids=` is a batch, not a page -- no limit is sent, qwbe sizes it.
    getMany: async <RecordType extends RaRecord = RaRecord>(
      cube: string,
      { ids }: GetManyParams<RecordType>,
    ): Promise<GetManyResult<RecordType>> => {
      const unique = [...new Set(ids.map(String))]
      if (unique.length === 0) return { data: [] as RecordType[] }
      const query = new URLSearchParams()
      query.set("ids", unique.join(","))
      const response = (await readJson(`${cubeApiPath(cube)}?${query.toString()}`)) as PageOf<Row>
      return { data: response.rows as RecordType[] }
    },

    // The unsupported stubs drop the params parameter entirely: a function
    // with fewer parameters is assignable to the DataProvider contract, and
    // no unused-variable lint suppression is needed.
    getManyReference: async <RecordType extends RaRecord = RaRecord>(
      cube: string,
    ): Promise<GetManyReferenceResult<RecordType>> => {
      throw new Error(
        `getManyReference is not supported by the qwbe data provider (${String(cube)})`,
      )
    },

    // The caller decides what travels: the renderers send only the changed,
    // coerced keys (changedPayloadOf), so an empty body is an empty PATCH
    // that never leaves -- the row stays as it is.
    update: async <RecordType extends RaRecord = RaRecord>(
      cube: string,
      { id, data, previousData }: UpdateParams<RecordType>,
    ): Promise<UpdateResult<RecordType>> => {
      if (demoOrganizationOf(cube, String(id))) throw new HttpError("Demo records are read-only", 403)
      if (Object.keys(data ?? {}).length === 0) return { data: previousData as RecordType }
      const response = await doFetch(rowApiPath(cube, id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!response.ok) throw await refusal(response)
      return { data: (await response.json()) as RecordType }
    },

    updateMany: async <RecordType extends RaRecord = RaRecord>(
      cube: string,
    ): Promise<UpdateManyResult<RecordType>> => {
      throw new Error(`updateMany is not supported by the qwbe data provider (${String(cube)})`)
    },

    create: async <
      RecordType extends Omit<RaRecord, "id">,
      ResultRecordType extends RaRecord = RecordType & { id: RaRecord["id"] },
    >(
      cube: string,
      { data }: CreateParams<RecordType>,
    ): Promise<CreateResult<ResultRecordType>> => {
      const response = await doFetch(cubeApiPath(cube), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!response.ok) throw await refusal(response)
      return { data: (await response.json()) as ResultRecordType }
    },

    // qwbe has no DELETE endpoints; the provider refuses rather than faking.
    delete: async <RecordType extends RaRecord = RaRecord>(
      cube: string,
    ): Promise<DeleteResult<RecordType>> => {
      throw new Error(`delete is not supported by the qwbe data provider (${String(cube)})`)
    },

    deleteMany: async <RecordType extends RaRecord = RaRecord>(
      cube: string,
    ): Promise<DeleteManyResult<RecordType>> => {
      throw new Error(`deleteMany is not supported by the qwbe data provider (${String(cube)})`)
    },
  }
}
