import { Schema } from 'effect'

/**
 * Refuses U+0000 anywhere in a string. Postgres text types cannot store it ("the character with code zero cannot
 * be stored", https://www.postgresql.org/docs/current/datatype-character.html), so without this check a NUL passes
 * validation and the INSERT or WHERE that receives it fails with a 500. Every user-supplied string that reaches
 * Postgres carries it (a post body, an account's name and email, a token a query looks up), first among its checks,
 * so the client gets a 400 that names the field instead.
 */
export const isFreeOfNul = Schema.makeFilter<string>((value) => !value.includes('\u0000'), {
  expected: 'a string without U+0000',
  message: 'Remove the invisible NUL character (U+0000) from the text.',
  toJsonSchema: () => ({ pattern: '^[^\\u0000]*$' }),
})
