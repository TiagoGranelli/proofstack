import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from 'effect/http-api'
import { Authentication } from './middleware.ts'

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}).annotate({ identifier: 'User', description: 'The signed-in user, without credentials or session data.' })

/**
 * The smallest authenticated operation: whose session this is. It needs no feature and no table of its own, so
 * the security tests (sessions, CSRF, caching, a database outage) keep their subject when the example feature is
 * removed.
 */
export class Me extends HttpApiGroup.make('me')
  .add(HttpApiEndpoint.get('get', '/me', { success: User }))
  .middleware(Authentication)
  .prefix('/api')
  .annotateMerge(OpenApi.annotations({ title: 'Me', description: 'The signed-in user.' })) {}
