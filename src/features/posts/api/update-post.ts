import { useMutation, useQueryClient } from '@tanstack/react-query'
import { postListsChanged, replaceMyPost } from '#/features/posts/api/posts-cache.ts'
import { myPostsUpdateMutation } from '#/sdk/@tanstack/react-query.gen.ts'

type UpdatePostConfig = Omit<ReturnType<typeof myPostsUpdateMutation>, 'mutationFn'>

/**
 * Saves an edited post. The saved post replaces the cached one before the caller's `onSuccess` runs, then
 * both post lists are invalidated.
 */
export function useUpdatePost({ mutationConfig }: { mutationConfig?: UpdatePostConfig } = {}) {
  const queryClient = useQueryClient()
  const { onSuccess, ...config } = mutationConfig ?? {}
  return useMutation({
    ...config,
    ...myPostsUpdateMutation(),
    meta: { invalidates: postListsChanged() },
    onSuccess: async (...args) => {
      replaceMyPost(queryClient, args[0])
      await onSuccess?.(...args)
    },
  })
}
