// The `seed` project (playwright.config.ts): runs once, before every browser project, and writes the only
// shared data the specs need. Publishing it here rather than in a spec keeps the bulk write out of the time
// when other specs publish a post and expect it on the first page of `/` (see ./support/app.ts).
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, PAGINATED_AUTHOR, signIn, test as setup } from './support/app.ts'

setup('an author with more posts than fit on one page', async ({ request, author }) => {
  await signIn(request, author)
  // One at a time, so the creation order is the list order.
  for (const body of PAGINATED_AUTHOR.bodies)
    expect((await request.post('/api/me/posts', { data: { body } })).status()).toBe(201)
  mkdirSync(dirname(PAGINATED_AUTHOR.storageState), { recursive: true })
  await request.storageState({ path: PAGINATED_AUTHOR.storageState })
})
