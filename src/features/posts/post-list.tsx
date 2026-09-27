import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription } from '#/components/ui/card.tsx'
import type { Post } from '#/sdk/types.gen.ts'

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' })

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

/**
 * A post's card. `children` replaces the body (the edit form uses it), `actions` sit next to the byline
 * and `alert` goes last.
 */
export function PostCard(props: {
  post: Post
  actions?: ReactNode
  alert?: ReactNode
  children?: ReactNode
  busy?: boolean
}) {
  const { post } = props
  return (
    <Card aria-busy={props.busy || undefined}>
      <CardContent className="grid gap-2">
        {props.children ?? <p className="break-words whitespace-pre-wrap">{post.body}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardDescription>
            {post.authorName} · <time dateTime={post.createdAt}>{dateFormat.format(new Date(post.createdAt))}</time>
            {post.updatedAt === post.createdAt ? null : ' · edited'}
          </CardDescription>
          {props.actions ? <div className="flex gap-1">{props.actions}</div> : null}
        </div>
        {props.alert}
      </CardContent>
    </Card>
  )
}
