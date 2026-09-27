import { useMutation, useQueryClient } from '@tanstack/react-query'
import { dropMyPost, postListsChanged } from '#/features/posts/api/posts-cache.ts'
import { apiErrorTag } from '#/lib/api-error.ts'
import { myPostsRemoveMutation } from '#/sdk/@tanstack/react-query.gen.ts'

type DeletePostConfig = Omit<ReturnType<typeof myPostsRemoveMutation>, 'mutationFn'>

/** The post was already gone (deleted in another tab): not worth an alert, the refetch removes it. */
export const isPostNotFound = (error: unknown) => apiErrorTag(error) === 'PostNotFound'

/**
 * Deletes a post. The post leaves the cached list before the caller's `onSuccess` runs, then both post lists
 * are invalidated. A PostNotFound error also invalidates them, so the stale entry disappears.
 */
export function useDeletePost({ mutationConfig }: { mutationConfig?: DeletePostConfig } = {}) {
  const queryClient = useQueryClient()
  const { onSuccess, ...config } = mutationConfig ?? {}
  return useMutation({
    ...config,
    ...myPostsRemoveMutation(),
    meta: { invalidates: postListsChanged(), invalidatesOnError: isPostNotFound },
    onSuccess: async (...args) => {
      dropMyPost(queryClient, args[1].path.id)
      await onSuccess?.(...args)
    },
  })
}
