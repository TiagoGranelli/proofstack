import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { awaitPublicPostsAfterWrite, getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import { PostList } from '#/features/posts/components/post-list.tsx'

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: 'Latest posts · ProofStack' }] }),
  // After a post was published, edited or deleted in this tab, wait for the new list instead of showing
  // the old one first. Otherwise a revisit renders the cached list at once and revalidates it.
  beforeLoad: ({ context }) => awaitPublicPostsAfterWrite(context.queryClient),
  // Dynamic public content: SSR on every request, never prerendered. On the server this fetches the first
  // page; in the browser it returns the cached pages at once.
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(getPublicPostsQueryOptions()),
  // The HTML carries a per-request CSP nonce, so shared caches must not store it; browsers revalidate.
  headers: () => ({ 'cache-control': 'private, no-cache' }),
  component: Home,
})

function Home() {
  const posts = useSuspenseInfiniteQuery(getPublicPostsQueryOptions())
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4">
      <h1 className="text-2xl font-semibold">Latest posts</h1>
      <PostList pages={posts} empty="No posts yet." testId="public-posts" />
    </main>
  )
}
