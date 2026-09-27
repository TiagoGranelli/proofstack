import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { myPostsQuery } from '#/features/posts/api/posts-cache.ts'
import { MyPost } from '#/features/posts/components/my-post.tsx'
import { PostComposer } from '#/features/posts/components/post-composer.tsx'
import { PostList } from '#/features/posts/components/post-list.tsx'
import { authClient } from '#/lib/auth-client.ts'

export const Route = createFileRoute('/_authed/dashboard')({
  head: () => ({ meta: [{ title: 'Dashboard · ProofStack' }, { name: 'robots', content: 'noindex' }] }),
  loader: ({ context }) => context.queryClient.fetchQuery(myPostsQuery()),
  component: Dashboard,
})

function Dashboard() {
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: posts } = useSuspenseQuery(myPostsQuery())
  // Screen-reader confirmation for writes whose result is otherwise only visual. `id` changes on every
  // write, so the same sentence twice in a row ("Post saved.") is a new node and is announced again.
  const [status, setStatus] = useState({ text: '', id: 0 })
  const announce = (text: string) => setStatus((previous) => ({ text, id: previous.id + 1 }))
  const [signOut, setSignOut] = useState<'idle' | 'pending' | 'failed'>('idle')
  const listHeading = useRef<HTMLHeadingElement>(null)
  return (
    <main className="mx-auto grid max-w-2xl gap-6 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{user.name}'s posts</h1>
        <Button
          type="button"
          variant="outline"
          disabled={signOut === 'pending'}
          aria-busy={signOut === 'pending'}
          onClick={async () => {
            setSignOut('pending')
            try {
              const { error } = await authClient.signOut()
              if (error) return setSignOut('failed')
            } catch {
              // The request never got a response (offline, connection reset).
              return setSignOut('failed')
            }
            queryClient.clear()
            await navigate({ to: '/' })
          }}
        >
          Sign out
        </Button>
      </div>
      {signOut === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          Could not sign out. Check your connection and try again.
        </p>
      ) : null}
      <PostComposer onPublished={() => announce('Post published.')} />
      <section aria-labelledby="published-heading" className="grid gap-3">
        <h2 id="published-heading" ref={listHeading} tabIndex={-1} className="text-lg font-semibold outline-none">
          Published
        </h2>
        <PostList
          posts={posts}
          empty="You have not published anything yet."
          testId="my-posts"
          renderPost={(post) => (
            <MyPost
              post={post}
              onUpdated={() => announce('Post saved.')}
              onDeleted={() => {
                announce('Post deleted.')
                // The Delete button that had focus is gone; keep keyboard users in the list.
                listHeading.current?.focus()
              }}
            />
          )}
        />
      </section>
      <output className="sr-only">
        <span key={status.id}>{status.text}</span>
      </output>
    </main>
  )
}
