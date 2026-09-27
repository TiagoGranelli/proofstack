import { apiClient } from '#/lib/api-client.ts'
import { myPostsListOptions } from '#/sdk/@tanstack/react-query.gen.ts'

/** The signed-in author's posts, newest first. Isomorphic, like getPublicPostsQueryOptions. */
export const getMyPostsQueryOptions = () => myPostsListOptions({ client: apiClient() })
