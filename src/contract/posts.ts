import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from 'effect/unstable/httpapi'
import { WRITE_WINDOW_SECONDS, WRITES_PER_WINDOW } from './limits.ts'
import { Authentication, RequestValidation, WriteRateLimit } from './middleware.ts'
import { PageQuery, pageOf } from './pages.ts'
import { PostInput } from './post-input.ts'

const Post = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  authorName: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).annotate({ identifier: 'Post' })
export type Post = typeof Post.Type

// `Post.pipe(HttpApiSchema.status(201))` would be a second schema with the identifier `Post`, which the
// OpenAPI generator emits as a duplicate component `Post_1`. The status goes on a suspended reference
// instead, so the 201 response points at the one `Post` component.
const Created = Schema.suspend(() => Post).pipe(HttpApiSchema.status(201))

const PostPath = { id: Schema.String }

const PostPage = pageOf(Post).annotate({
  identifier: 'PostPage',
  description: 'One page of posts, newest first. `nextCursor` is null on the last page.',
})
export type PostPage = typeof PostPage.Type

export class PostNotFound extends Schema.TaggedError<PostNotFound>()(
  'PostNotFound',
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

export class PublicPosts extends HttpApiGroup.make('publicPosts')
  .add(HttpApiEndpoint.get('list', '/posts', { query: PageQuery, success: PostPage }).middleware(RequestValidation))
  .prefix('/api')
  .annotateMerge(OpenApi.annotations({ title: 'Public posts', description: 'Anonymous read access.' })) {}

export class MyPosts extends HttpApiGroup.make('myPosts')
  .add(
    HttpApiEndpoint.get('list', '/me/posts', { query: PageQuery, success: PostPage }).middleware(RequestValidation),
    HttpApiEndpoint.post('create', '/me/posts', {
      payload: PostInput,
      success: Created,
    })
      .middleware(RequestValidation)
      .middleware(WriteRateLimit),
    HttpApiEndpoint.patch('update', '/me/posts/:id', {
      params: PostPath,
      payload: PostInput,
      success: Post,
      error: PostNotFound,
    })
      .middleware(RequestValidation)
      .middleware(WriteRateLimit),
    // No RequestValidation: the only input is the path id, a plain string that cannot fail to decode. A
    // malformed id is a 404 like a missing one (as on update), so a 400 is never answered and not declared.
    HttpApiEndpoint.delete('remove', '/me/posts/:id', {
      params: PostPath,
      success: HttpApiSchema.NoContent,
      error: PostNotFound,
    }).middleware(WriteRateLimit),
  )
  // Added last, so it runs first: WriteRateLimit counts by the CurrentUser it provides.
  .middleware(Authentication)
  .prefix('/api')
  .annotateMerge(
    OpenApi.annotations({
      title: 'My posts',
      description:
        `CRUD for the signed-in author. Creating, editing and deleting count together against a limit of ` +
        `${WRITES_PER_WINDOW} per ${WRITE_WINDOW_SECONDS} s per user; past it they answer 429.`,
    }),
  ) {}
