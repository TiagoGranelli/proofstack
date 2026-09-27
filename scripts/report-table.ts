/** A plain-text table for the report scripts (`pnpm deps:check`, `pnpm images:check`). */
export const table = (header: string[], rows: string[][]) => {
  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((row) => (row[i] ?? '').length)))
  const line = (row: string[]) =>
    row
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map((row) => line(row))].join('\n')
}
