import type { ReactElement, ReactNode } from 'react'
import { RelativeTime } from '#/components/time/relative-time.tsx'
import { Card, CardContent, CardDescription } from '#/components/ui/card.tsx'
import type { Post } from '#/sdk/types.gen.ts'

/**
 * A post's card. `children` replaces the body (the edit form uses it), `actions` sit next to the byline
 * and `alert` goes last.
 */
export function PostCard(props: {
  post: Post
  actions?: ReactElement
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
            {post.authorName} · <RelativeTime iso={post.createdAt} />
            {post.updatedAt === post.createdAt ? null : ' · edited'}
          </CardDescription>
          {props.actions ? <div className="flex gap-1">{props.actions}</div> : null}
        </div>
        {props.alert}
      </CardContent>
    </Card>
  )
}
