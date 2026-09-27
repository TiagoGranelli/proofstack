import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { PostList } from '#/features/posts/post-list.tsx'
import { awaitPublicPostsAfterWrite, publicPostsQuery } from '#/features/posts/queries.ts'

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: 'Latest posts · ProofStack' }] }),
  // After a post was published, edited or deleted in this tab, wait for the new list instead of showing
  // the old one first. Otherwise a revisit renders the cached list at once and revalidates it.
  beforeLoad: ({ context }) => awaitPublicPostsAfterWrite(context.queryClient),
  // Dynamic public content: SSR on every request, never prerendered. fetchQuery (not ensureQueryData)
  // refetches once the cached list is past its staleTime.
  loader: ({ context }) => context.queryClient.fetchQuery(publicPostsQuery()),
  // The HTML carries a per-request CSP nonce, so shared caches must not store it; browsers revalidate.
  headers: () => ({ 'cache-control': 'private, no-cache' }),
  component: Home,
})

function Home() {
  const { data: posts } = useSuspenseQuery(publicPostsQuery())
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4">
      <h1 className="text-2xl font-semibold">Latest posts</h1>
      <PostList posts={posts} empty="No posts yet." testId="public-posts" />
    </main>
  )
}
