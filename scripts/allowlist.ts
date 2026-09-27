// Reads a vulnerability allowlist in security/ (audit-allowlist.json for `pnpm audit:check`,
// image-allowlist.json for the image scan in `pnpm ci:docker`): `{ "<list>": [{ <id>, package, reason,
// expires }] }`. Returns the valid, unexpired entries and a problem for every other one. The callers add a
// problem for each entry that matches no finding, so the lists only hold decisions that still apply.
import { readFileSync } from 'node:fs'

const MAX_DAYS = 180
const DAY_MS = 24 * 60 * 60 * 1000

export type Allowed = { id: string; name: string; expires: string }

export const readAllowlist = (file: string, list: string, idField: string, idPattern: RegExp) => {
  const problems: string[] = []
  const raw = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)[list]
  if (!Array.isArray(raw)) return { entries: [], problems: [`${file}: \`${list}\` must be an array`] }
  const today = new Date().toISOString().slice(0, 10)
  const entries = (raw as Array<Record<string, unknown>>).flatMap((entry, index): Allowed[] => {
    const where = `${file} entry ${index + 1}`
    const { [idField]: id, package: name, reason, expires } = entry
    if (typeof id !== 'string' || !idPattern.test(id)) problems.push(`${where}: \`${idField}\` must match ${idPattern}`)
    else if (typeof name !== 'string' || !name) problems.push(`${where} (${id}): \`package\` is required`)
    else if (typeof reason !== 'string' || reason.trim().length < 20)
      problems.push(`${where} (${id}): \`reason\` must say why the finding does not apply`)
    else if (typeof expires !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(Date.parse(expires)))
      problems.push(`${where} (${id}): \`expires\` must be a YYYY-MM-DD date`)
    else if (expires < today) problems.push(`${where} (${id} in ${name}): expired on ${expires}; review it again`)
    else if (Date.parse(expires) - Date.parse(today) > MAX_DAYS * DAY_MS)
      problems.push(`${where} (${id} in ${name}): expires more than ${MAX_DAYS} days ahead`)
    else return [{ id, name, expires }]
    return []
  })
  return { entries, problems }
}
