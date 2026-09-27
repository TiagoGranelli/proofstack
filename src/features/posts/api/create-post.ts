import { useMutation } from '@tanstack/react-query'
import { postListsChanged } from '#/features/posts/api/posts-cache.ts'
import { myPostsCreateMutation } from '#/sdk/@tanstack/react-query.gen.ts'

type CreatePostConfig = Omit<ReturnType<typeof myPostsCreateMutation>, 'mutationFn'>

/**
 * Publishes a post. The caller's `onSuccess` runs first (reset the form, announce), then both post lists are
 * refreshed; the mutation stays pending until both have been refetched (see postListsChanged).
 */
export function useCreatePost({ mutationConfig }: { mutationConfig?: CreatePostConfig } = {}) {
  return useMutation({ ...mutationConfig, ...myPostsCreateMutation(), meta: { invalidates: postListsChanged() } })
}
