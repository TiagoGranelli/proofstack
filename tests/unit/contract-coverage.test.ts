// scripts/contract-coverage.ts, run by verify:app: declared statuses must be observed, observed ones declared,
// and the allowlist must hold only live gaps with reasons.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALLOWLIST, contractCoverageProblems, logObservations, operations } from '../../scripts/contract-coverage.ts'

const spec = {
  paths: {
    '/api/me/posts/{id}': { patch: { responses: { '200': {}, '404': {} } }, delete: { responses: { '204': {} } } },
  },
}
const ops = operations(spec)
const none = { unobserved: [], undeclared: [] }
const seen = (method: string, path: string, status: number) => ({ method, path, status })

describe('contractCoverageProblems', () => {
  it('passes when every declared status was seen, on any concrete path of the operation', () => {
    const observed = [
      seen('PATCH', '/api/me/posts/1', 200),
      seen('PATCH', '/api/me/posts/not-a-uuid', 404),
      seen('DELETE', '/api/me/posts/2', 204),
      // Not an operation of the contract: ignored.
      seen('GET', '/api/me/posts/2', 405),
      seen('PATCH', '/api/me/posts/1/extra', 404),
    ]
    expect(contractCoverageProblems(ops, observed, none)).toEqual([])
  })

  it('names each declared status nobody saw and each undeclared one somebody saw', () => {
    const observed = [seen('PATCH', '/api/me/posts/1', 200), seen('DELETE', '/api/me/posts/1', 403)]
    expect(contractCoverageProblems(ops, observed, none)).toEqual([
      'PATCH /api/me/posts/{id} declares 404, but no test saw it answered',
      'DELETE /api/me/posts/{id} declares 204, but no test saw it answered',
      'DELETE /api/me/posts/{id} answered 403, which openapi.json does not declare',
    ])
  })

  it('accepts allowlisted gaps with a reason, for one operation or all, and rejects stale or unexplained ones', () => {
    const observed = [seen('PATCH', '/api/me/posts/1', 200), seen('DELETE', '/api/me/posts/1', 403)]
    const allowlist = {
      unobserved: [
        { operation: 'PATCH /api/me/posts/{id}', status: 404, reason: 'why' },
        { operation: 'DELETE /api/me/posts/{id}', status: 204, reason: ' ' },
      ],
      undeclared: [
        { operation: '*', status: 403, reason: 'CSRF' },
        { operation: '*', status: 500, reason: 'never seen' },
      ],
    }
    expect(contractCoverageProblems(ops, observed, allowlist)).toEqual([
      `${ALLOWLIST}: DELETE /api/me/posts/{id} 204 needs a reason`,
      `${ALLOWLIST}: * 500 matches no gap any more; remove it`,
    ])
  })
})

describe('logObservations', () => {
  it('reads request lines of the app log and skips everything else, aborted requests included', () => {
    const log = [
      'Listening on http://localhost:3000',
      '{"time":"t","level":"info","msg":"request","method":"GET","path":"/api/posts","status":200,"ms":3}',
      '{"time":"t","level":"error","msg":"api defect","method":"GET","path":"/api/posts"}',
      '{"time":"t","level":"error","msg":"request","method":"GET","path":"/api/posts","status":500}',
      '{"time":"t","level":"info","msg":"request","method":"GET","path":"/api/posts","status":499,"aborted":true}',
      '{not json',
    ].join('\n')
    expect(logObservations(log)).toEqual([seen('GET', '/api/posts', 200), seen('GET', '/api/posts', 500)])
  })
})

describe('the committed allowlist', () => {
  it('gives every entry a reason', () => {
    const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as Record<string, Array<{ reason: string }>>
    for (const entry of Object.values(allowlist).flat()) expect(entry.reason.trim().length).toBeGreaterThan(20)
  })
})
