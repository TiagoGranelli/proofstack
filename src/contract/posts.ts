import { Schema, SchemaTransformation } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from 'effect/unstable/httpapi'
import {
  POST_MAX_LENGTH,
  POST_WRITE_WINDOW_SECONDS,
  POST_WRITES_PER_WINDOW,
  POSTS_PAGE_DEFAULT,
  POSTS_PAGE_MAX,
} from './limits.ts'
import { Authentication, RequestValidation, WriteRateLimit } from './middleware.ts'

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

// Microsecond UTC timestamp as Postgres stores it (`Post.createdAt` is rounded to milliseconds, which is
// not precise enough to resume a keyset scan without skipping or repeating rows).
const CURSOR_TIME = /^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/
/**
 * Rejects well-formed but impossible dates such as February 30 (the pattern already rules out year 0), so
 * they never reach Postgres, which would fail the query instead of answering 400.
 */
const isCalendarDate = Schema.makeFilter<string>(
  (value) => {
    const date = new Date(`${value.slice(0, 23)}Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 23) === value.slice(0, 23)
  },
  { expected: 'a valid calendar date' },
)

/**
 * Where the next page starts: the (createdAt, id) key of the last post of the previous page. Lists are
 * ordered by that pair, newest first, so a page is "every post with a smaller key", and posts published
 * while a client pages through never shift the pages it has not fetched yet. On the wire it is an opaque
 * base64url string; anything that does not decode to a valid key is a 400.
 */
const PageCursor = Schema.String.annotate({
  identifier: 'PageCursor',
  description: 'Opaque cursor from `nextCursor` of the previous page. Omit it for the first page.',
}).pipe(
  Schema.decodeTo(Schema.String, SchemaTransformation.stringFromBase64UrlString),
  Schema.decodeTo(
    Schema.fromJsonString(
      Schema.Struct({
        createdAt: Schema.String.check(Schema.isPattern(CURSOR_TIME), isCalendarDate),
        id: Schema.String.check(Schema.isUUID()),
      }),
    ),
  ),
)
export type PageCursor = typeof PageCursor.Type

// Query parameters arrive as strings. The pattern keeps "1e1" or " 5" out; the range is checked on the number.
const PageLimit = Schema.String.check(Schema.isPattern(/^\d{1,3}$/, { expected: 'a whole number' }))
  .annotate({ description: `Posts per page, 1 to ${POSTS_PAGE_MAX}. Default ${POSTS_PAGE_DEFAULT}.` })
  .pipe(
    Schema.decodeTo(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: POSTS_PAGE_MAX })),
      SchemaTransformation.numberFromString,
    ),
  )

const PageQuery = { cursor: Schema.optionalKey(PageCursor), limit: Schema.optionalKey(PageLimit) }

const PostPage = Schema.Struct({
  items: Schema.Array(Post),
  nextCursor: Schema.NullOr(PageCursor),
}).annotate({
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
    HttpApiEndpoint.delete('remove', '/me/posts/:id', {
      params: PostPath,
      success: HttpApiSchema.NoContent,
      error: PostNotFound,
    })
      .middleware(RequestValidation)
      .middleware(WriteRateLimit),
  )
  // Added last, so it runs first: WriteRateLimit counts by the CurrentUser it provides.
  .middleware(Authentication)
  .prefix('/api')
  .annotateMerge(
    OpenApi.annotations({
      title: 'My posts',
      description:
        `CRUD for the signed-in author. Creating, editing and deleting count together against a limit of ` +
        `${POST_WRITES_PER_WINDOW} per ${POST_WRITE_WINDOW_SECONDS} s per user; past it they answer 429.`,
    }),
  ) {}
