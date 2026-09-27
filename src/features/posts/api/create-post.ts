import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidatePosts } from '#/features/posts/api/posts-cache.ts'
import { myPostsCreateMutation } from '#/sdk/@tanstack/react-query.gen.ts'

type CreatePostConfig = Omit<ReturnType<typeof myPostsCreateMutation>, 'mutationFn'>

/**
 * Publishes a post. The caller's `onSuccess` runs first (reset the form, announce), then both post lists are
 * refreshed; the mutation stays pending until both have been refetched (see invalidatePosts).
 */
export function useCreatePost({ mutationConfig }: { mutationConfig?: CreatePostConfig } = {}) {
  const queryClient = useQueryClient()
  const { onSuccess, ...config } = mutationConfig ?? {}
  return useMutation({
    ...config,
    ...myPostsCreateMutation(),
    onSuccess: async (...args) => {
      await onSuccess?.(...args)
      await invalidatePosts(queryClient)
    },
  })
}
