// lazyFormSchema (src/components/form/lazy-schema.ts): a form's Effect Schema loaded on the first interaction. It
// loads once, validates and decodes with the real schema once loaded, refuses to answer before, and retries a
// load that failed (a chunk request that did not arrive).
import { Schema } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'

const Name = Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1, { message: 'Enter your name.' })) })

describe('lazyFormSchema', () => {
  it('loads the schema once, however often it is asked', async () => {
    const load = vi.fn<() => Promise<typeof Name>>(async () => Name)
    const schema = lazyFormSchema(load)
    expect(load).not.toHaveBeenCalled()
    await Promise.all([schema.load(), schema.load()])
    await schema.load()
    expect(load).toHaveBeenCalledOnce()
  })

  it('validates and decodes with the schema once it has loaded', async () => {
    const schema = lazyFormSchema(async () => Name)
    await schema.load()
    expect(schema.validator['~standard'].validate({ name: '' })).toMatchObject({
      issues: [{ message: 'Enter your name.', path: ['name'] }],
    })
    expect(schema.decode({ name: 'Ada' })).toEqual({ name: 'Ada' })
  })

  it('refuses to validate or decode before it has loaded, instead of passing everything', () => {
    const schema = lazyFormSchema(async () => Name)
    expect(() => schema.validator['~standard'].validate({ name: '' })).toThrow('used before it loaded')
    expect(() => schema.decode({ name: 'Ada' })).toThrow('used before it loaded')
  })

  it('tries again after a load that failed', async () => {
    const load = vi.fn<() => Promise<typeof Name>>()
    load.mockRejectedValueOnce(new Error('chunk request failed')).mockResolvedValueOnce(Name)
    const schema = lazyFormSchema(load)
    await expect(schema.load()).rejects.toThrow('chunk request failed')
    await schema.load()
    expect(schema.decode({ name: 'Ada' })).toEqual({ name: 'Ada' })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
