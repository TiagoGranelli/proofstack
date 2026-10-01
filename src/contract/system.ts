import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { ServiceUnavailable } from './errors.ts'

const Health = Schema.Struct({ status: Schema.Literal('ok') }).annotate({ identifier: 'Health' })

export class System extends HttpApiGroup.make('system')
  .add(
    // Liveness: the process answers HTTP. Does not touch dependencies.
    HttpApiEndpoint.get('health', '/health', { success: Health }),
    // Readiness: the database answers. Load balancers should route traffic only when this is 200.
    HttpApiEndpoint.get('ready', '/ready', { success: Health, error: ServiceUnavailable }),
  )
  .prefix('/api') {}
