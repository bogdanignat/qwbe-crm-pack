// "Edit" from a list row (vtiger's edit link): the record's page, opened in
// edit mode. The page reads the parameter once (hooks/use-edit-on-open.ts).

export const EDIT_ALL_PARAM = "edit"

export function editAllHref(recordHref: string): string {
  return `${recordHref}?${EDIT_ALL_PARAM}=all`
}
