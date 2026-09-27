import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '#/config/app.ts'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import { PostList } from '#/features/posts/components/post-list.tsx'

export const Route = createFileRoute('/')({
  // Dynamic public content: SSR on every request, never prerendered. On the server this fetches the first
  // page; in the browser it returns the cached pages at once. Writes in this tab refetch the cached list
  // before they finish (postListsChanged), so a revisit never shows posts older than the last write.
  loader: ({ context }) => context.queryClient.infiniteQuery({ ...getPublicPostsQueryOptions(), staleTime: 'static' }),
  head: () => ({ meta: [{ title: pageTitle('Latest posts') }] }),
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
