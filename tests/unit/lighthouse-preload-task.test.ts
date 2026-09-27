// scripts/lighthouse-runs.ts: the preload task, the main-thread task that requested the page's first stylesheet or
// script. The numbers are from the CI run whose mobile scores fell to 99 (ADR 0011): the navigation commit ran
// 31.9 ms on the 2-vCPU runner, against 5-10 ms on the maintainer's laptop.
import { describe, expect, it } from 'vitest'
import { type Lhr, preloadTaskMs } from '../../scripts/lighthouse-runs.ts'

const report = (requests: Record<string, unknown>[], tasks: Record<string, unknown>[]): Lhr => ({
  finalDisplayedUrl: 'https://localhost/',
  runWarnings: [],
  environment: { benchmarkIndex: 2258 },
  categories: {},
  audits: {
    'network-requests': { score: null, scoreDisplayMode: 'informative', title: '', details: { items: requests } },
    'main-thread-tasks': { score: null, scoreDisplayMode: 'informative', title: '', details: { items: tasks } },
  },
})

const documentRequest = { resourceType: 'Document', rendererStartTime: 0 }
const stylesheet = { resourceType: 'Stylesheet', rendererStartTime: 61.9 }
const tasks = [
  { startTime: 45.5, duration: 31.9 },
  { startTime: 137, duration: 10.1 },
]

describe('preloadTaskMs', () => {
  it('is the duration of the task during which the first stylesheet or script was requested', () => {
    expect(preloadTaskMs(report([documentRequest, stylesheet], tasks))).toBe(31.9)
  })

  it('also finds a script requested first', () => {
    const script = { resourceType: 'Script', rendererStartTime: 140 }
    expect(preloadTaskMs(report([documentRequest, script], tasks))).toBe(10.1)
  })

  it('is null when no subresource was requested or no task contains the request', () => {
    expect(preloadTaskMs(report([documentRequest], tasks))).toBeNull()
    expect(preloadTaskMs(report([documentRequest, { ...stylesheet, rendererStartTime: 100 }], tasks))).toBeNull()
    expect(preloadTaskMs(report([documentRequest, { resourceType: 'Stylesheet' }], tasks))).toBeNull()
  })
})
