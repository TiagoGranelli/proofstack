// Writes openapi.json from the Effect HttpApi contract. Deterministic: no server, no database.
import { writeFileSync } from 'node:fs'
import { OpenApi } from 'effect/http-api'
import { Api } from '#/contract/api.ts'

const renderOpenApi = () => `${JSON.stringify(OpenApi.fromApi(Api), null, 2)}\n`

if (import.meta.main) {
  const target = new URL('../openapi.json', import.meta.url)
  writeFileSync(target, renderOpenApi())
  console.log(`wrote ${target.pathname}`)
}
