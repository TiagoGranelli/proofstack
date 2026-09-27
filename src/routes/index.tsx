import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import { PostList } from '#/features/posts/components/post-list.tsx'

export const Route = createFileRoute('/')({
  // Dynamic public content: SSR on every request, never prerendered. On the server this fetches the first
  // page; in the browser it returns the cached pages at once. Writes in this tab refetch the cached list
  // before they finish (postListsChanged), so a revisit never shows posts older than the last write.
  loader: ({ context }) => context.queryClient.infiniteQuery({ ...getPublicPostsQueryOptions(), staleTime: 'static' }),
  head: () => ({ meta: [{ title: pageTitle('Latest posts') }] }),
  // The HTML carries a per-request CSP nonce and the header names whoever is signed in: no cache may keep it (the
  // session read, src/lib/session.functions.ts, says the same).
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: Home,
})

function Home() {
  const posts = useSuspenseInfiniteQuery(getPublicPostsQueryOptions())
  return (
    <Page title="Latest posts">
      <PostList pages={posts} empty="No posts yet." testId="public-posts" />
    </Page>
  )
}
