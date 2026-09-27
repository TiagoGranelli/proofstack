import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useSignOut } from '#/features/auth/api/sign-out.ts'
import { SignOutAlert, SignOutButton } from '#/features/auth/components/sign-out-button.tsx'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { MyPost } from '#/features/posts/components/my-post.tsx'
import { PostComposer } from '#/features/posts/components/post-composer.tsx'
import { PostList } from '#/features/posts/components/post-list.tsx'

export const Route = createFileRoute('/_authed/dashboard')({
  head: () => ({ meta: [{ title: 'Dashboard · ProofStack' }, { name: 'robots', content: 'noindex' }] }),
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(getMyPostsQueryOptions()),
  component: Dashboard,
})

function Dashboard() {
  const { user } = Route.useRouteContext()
  const posts = useSuspenseInfiniteQuery(getMyPostsQueryOptions())
  // Screen-reader confirmation for writes whose result is otherwise only visual. `id` changes on every
  // write, so the same sentence twice in a row ("Post saved.") is a new node and is announced again.
  const [status, setStatus] = useState({ text: '', id: 0 })
  const announce = (text: string) => setStatus((previous) => ({ text, id: previous.id + 1 }))
  const navigate = useNavigate()
  const signOut = useSignOut({ mutationConfig: { onSuccess: () => navigate({ to: '/' }) } })
  const listHeading = useRef<HTMLHeadingElement>(null)
  return (
    <main className="mx-auto grid max-w-2xl gap-6 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{user.name}'s posts</h1>
        <div className="flex items-center gap-4">
          <Link to="/account" className="text-sm underline underline-offset-4">
            Account
          </Link>
          <SignOutButton signOut={signOut} />
        </div>
      </div>
      <SignOutAlert signOut={signOut} />
      <PostComposer onPublished={() => announce('Post published.')} />
      <section aria-labelledby="published-heading" className="grid gap-3">
        <h2 id="published-heading" ref={listHeading} tabIndex={-1} className="text-lg font-semibold outline-none">
          Published
        </h2>
        <PostList
          pages={posts}
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
