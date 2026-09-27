// The business API contract. Shared by the server, OpenAPI generation and tests.
// Must stay free of server-only imports (enforced by .fallowrc.json boundaries).
import { HttpApi, OpenApi } from 'effect/unstable/httpapi'
import { MyPosts, PublicPosts } from './posts.ts'
import { System } from './system.ts'

export class Api extends HttpApi.make('proofstack')
  .add(System)
  .add(PublicPosts)
  .add(MyPosts)
  .annotateMerge(OpenApi.annotations({ title: 'ProofStack API', version: '0.1.0' })) {}
