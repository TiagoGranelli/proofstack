import { Schema } from 'effect'

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

const ValidationIssue = Schema.Struct({
  path: Schema.Array(Schema.String),
  message: Schema.String,
}).annotate({ identifier: 'ValidationIssue' })

export class ValidationError extends Schema.TaggedError<ValidationError>()(
  'ValidationError',
  { message: Schema.String, issues: Schema.Array(ValidationIssue) },
  { httpApiStatus: 400 },
) {}

export class ServiceUnavailable extends Schema.TaggedError<ServiceUnavailable>()(
  'ServiceUnavailable',
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}
