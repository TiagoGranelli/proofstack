// The business API contract. Shared by the server, OpenAPI generation and tests.
// Must stay free of server-only imports (enforced by .fallowrc.json boundaries).
import { HttpApi, OpenApi } from 'effect/unstable/httpapi'
import { MyPosts, PublicPosts } from './posts.ts'
import { System } from './system.ts'

export class Api extends HttpApi.make('proofstack')
  .add(System)
  .add(PublicPosts)
  .add(MyPosts)
  .annotateMerge(
    OpenApi.annotations({
      title: 'ProofStack API',
      version: '0.1.0',
      // Two answers come from outside this contract, before or after the handlers, and apply to every
      // operation alike; they are described here once instead of being declared per operation (see
      // scripts/contract-coverage.ts, which allowlists them with the same reasons).
      description:
        'Every POST, PATCH and DELETE must come from the app itself: `Sec-Fetch-Site: same-origin`, or an ' +
        '`Origin` (or `Referer`) equal to the app origin. Any other answers `403` with a plain-text body before ' +
        'the operation runs. An unexpected failure (a bug, or the database unreachable) answers `500` with an ' +
        'empty body. Neither carries a tagged error: treat both as a generic failure.',
    }),
  ) {}
