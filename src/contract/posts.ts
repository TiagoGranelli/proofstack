import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from 'effect/unstable/httpapi'
import { POST_MAX_LENGTH } from './limits.ts'
import { Authentication, RequestValidation } from './middleware.ts'

const Post = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  authorName: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).annotate({ identifier: 'Post' })
export type Post = typeof Post.Type

const PostInput = Schema.Struct({
  body: Schema.String.pipe(
    Schema.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(POST_MAX_LENGTH)),
  ),
}).annotate({ identifier: 'PostInput' })

// `Post.pipe(HttpApiSchema.status(201))` would be a second schema with the identifier `Post`, which the
// OpenAPI generator emits as a duplicate component `Post_1`. The status goes on a suspended reference
// instead, so the 201 response points at the one `Post` component.
const Created = Schema.suspend(() => Post).pipe(HttpApiSchema.status(201))

const PostPath = { id: Schema.String }

export class PostNotFound extends Schema.TaggedError<PostNotFound>()(
  'PostNotFound',
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

export class PublicPosts extends HttpApiGroup.make('publicPosts')
  .add(HttpApiEndpoint.get('list', '/posts', { success: Schema.Array(Post) }))
  .prefix('/api')
  .annotateMerge(OpenApi.annotations({ title: 'Public posts', description: 'Anonymous read access.' })) {}

export class MyPosts extends HttpApiGroup.make('myPosts')
  .add(
    HttpApiEndpoint.get('list', '/me/posts', { success: Schema.Array(Post) }),
    HttpApiEndpoint.post('create', '/me/posts', {
      payload: PostInput,
      success: Created,
    }).middleware(RequestValidation),
    HttpApiEndpoint.patch('update', '/me/posts/:id', {
      params: PostPath,
      payload: PostInput,
      success: Post,
      error: PostNotFound,
    }).middleware(RequestValidation),
    HttpApiEndpoint.delete('remove', '/me/posts/:id', {
      params: PostPath,
      success: HttpApiSchema.NoContent,
      error: PostNotFound,
    }).middleware(RequestValidation),
  )
  .middleware(Authentication)
  .prefix('/api')
  .annotateMerge(OpenApi.annotations({ title: 'My posts', description: 'CRUD for the signed-in author.' })) {}
