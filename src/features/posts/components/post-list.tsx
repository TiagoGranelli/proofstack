import type { InfiniteData, UseSuspenseInfiniteQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { LoadMoreList } from '#/components/lists/load-more-list.tsx'
import { PostCard } from '#/features/posts/components/post-card.tsx'
import type { Post, PostPage } from '#/sdk/types.gen.ts'

/** A list of posts, a page at a time with "Load more posts" (LoadMoreList). */
export function PostList(props: {
  pages: UseSuspenseInfiniteQueryResult<InfiniteData<PostPage>, unknown>
  empty: string
  testId: string
  /** Renders one post. Defaults to a read-only card. */
  renderPost?: (post: Post) => ReactNode
}) {
  return (
    <LoadMoreList
      pages={props.pages}
      noun="posts"
      empty={props.empty}
      testId={props.testId}
      renderItem={props.renderPost ?? ((post) => <PostCard post={post} />)}
    />
  )
}
