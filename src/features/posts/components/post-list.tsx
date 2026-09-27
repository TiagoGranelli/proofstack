import type { ReactNode } from 'react'
import { PostCard } from '#/features/posts/components/post-card.tsx'
import type { Post } from '#/sdk/types.gen.ts'

export function PostList(props: {
  posts: ReadonlyArray<Post>
  empty: string
  testId: string
  /** Renders one post. Defaults to a read-only card. */
  renderPost?: (post: Post) => ReactNode
}) {
  if (props.posts.length === 0) {
    return (
      <p data-testid={props.testId} className="text-muted-foreground">
        {props.empty}
      </p>
    )
  }
  const renderPost = props.renderPost ?? ((post: Post) => <PostCard post={post} />)
  return (
    <ul data-testid={props.testId} className="grid gap-3">
      {props.posts.map((post) => (
        <li key={post.id}>{renderPost(post)}</li>
      ))}
    </ul>
  )
}
