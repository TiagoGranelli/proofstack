import { Schema } from 'effect'

/**
 * What a form needs of its Effect Schema: the Standard Schema TanStack Form validates with, and the decoder that
 * turns the valid fields into what the action sends. Loaded only by ./lazy-schema.ts, through a dynamic import, so
 * the Schema runtime stays out of the chunks a page loads before the first interaction.
 */
export const toFormSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => ({
  validator: Schema.toStandardSchemaV1(schema),
  decode: Schema.decodeSync(schema),
})
