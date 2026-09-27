import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { MyPost } from '#/features/posts/components/my-post.tsx'
import { PostList } from '#/features/posts/components/post-list.tsx'

/**
 * The signed-in author's posts, each editable and deletable. It reads its own query (the route's loader fills
 * the cache first), so a section error boundary around it can contain its failures.
 */
export function MyPostList(props: { onUpdated?: () => void; onDeleted?: () => void }) {
  const posts = useSuspenseInfiniteQuery(getMyPostsQueryOptions())
  return (
    <PostList
      pages={posts}
      empty="You have not published anything yet."
      testId="my-posts"
      renderPost={(post) => <MyPost post={post} onUpdated={props.onUpdated} onDeleted={props.onDeleted} />}
    />
  )
}
