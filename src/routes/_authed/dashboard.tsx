import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { RouteError } from '#/components/errors/route-error.tsx'
import { SectionErrorBoundary } from '#/components/errors/section-error-boundary.tsx'
import { pageTitle } from '#/config/app.ts'
import { useSignOut } from '#/features/auth/api/sign-out.ts'
import { SignOutAlert, SignOutButton } from '#/features/auth/components/sign-out-button.tsx'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { MyPostList } from '#/features/posts/components/my-post-list.tsx'
import { PostComposer } from '#/features/posts/components/post-composer.tsx'

export const Route = createFileRoute('/_authed/dashboard')({
  loader: ({ context }) => context.queryClient.infiniteQuery({ ...getMyPostsQueryOptions(), staleTime: 'static' }),
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }, { name: 'robots', content: 'noindex' }] }),
  // The loader's failures. Once the page is up, the composer and the list fail on their own (SectionErrorBoundary).
  errorComponent: (props) => <RouteError {...props} title="Your posts could not be loaded" action="load your posts" />,
  component: Dashboard,
})

function Dashboard() {
  const { user } = Route.useRouteContext()
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
      <SectionErrorBoundary action="show the post form">
        <PostComposer onPublished={() => announce('Post published.')} />
      </SectionErrorBoundary>
      <section aria-labelledby="published-heading" className="grid gap-3">
        <h2 id="published-heading" ref={listHeading} tabIndex={-1} className="text-lg font-semibold outline-none">
          Published
        </h2>
        <SectionErrorBoundary action="show your posts">
          <MyPostList
            onUpdated={() => announce('Post saved.')}
            onDeleted={() => {
              announce('Post deleted.')
              // The Delete button that had focus is gone; keep keyboard users in the list.
              listHeading.current?.focus()
            }}
          />
        </SectionErrorBoundary>
      </section>
      <output className="sr-only">
        <span key={status.id}>{status.text}</span>
      </output>
    </main>
  )
}
