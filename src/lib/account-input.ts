import { Schema, type SchemaAST, SchemaTransformation } from 'effect'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'

// The input of every account action, in one place: the server functions (./auth.functions.ts) validate with these
// schemas, and the account forms validate the same ones in the browser through Standard Schema before they send.
// The messages are the ones the forms show next to a field.

/** A string with leading and trailing whitespace dropped before `checks` (a pasted address often has some). */
const trimmed = (...checks: [SchemaAST.Check<string>, ...Array<SchemaAST.Check<string>>]) =>
  Schema.String.pipe(Schema.decodeTo(Schema.String.check(...checks), SchemaTransformation.trim()))

const INVALID_EMAIL = 'Enter a valid email address.'
const Email = trimmed(
  Schema.isMinLength(1, { message: 'Enter your email address.' }),
  Schema.isMaxLength(254, { message: INVALID_EMAIL }),
  Schema.isPattern(/^[^\s@]+@[^\s@]+$/, { message: INVALID_EMAIL }),
)

/** A password the account already has: only bounded, because older rules may have allowed other lengths. */
const CurrentPassword = Schema.String.check(
  Schema.isMinLength(1, { message: 'Enter your password.' }),
  Schema.isMaxLength(PASSWORD_MAX_LENGTH, { message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` }),
)

const NewPassword = Schema.String.check(
  Schema.isMinLength(PASSWORD_MIN_LENGTH, { message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` }),
  Schema.isMaxLength(PASSWORD_MAX_LENGTH, { message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` }),
)

const Name = trimmed(
  Schema.isMinLength(1, { message: 'Enter your name.' }),
  Schema.isMaxLength(100, { message: 'Use at most 100 characters.' }),
)

/** Tokens from links and session ids: never typed by the user, so no message of their own. */
const Token = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))

export const SignInInput = Schema.Struct({ email: Email, password: CurrentPassword })
export const SignUpInput = Schema.Struct({ name: Name, email: Email, password: NewPassword })
/** Resending a confirmation link, or asking for a reset link. */
export const EmailInput = Schema.Struct({ email: Email })
export const TokenInput = Schema.Struct({ token: Token })
export const SessionInput = Schema.Struct({ id: Token })
/** The reset form's field; the token comes from the link. */
export const NewPasswordInput = Schema.Struct({ newPassword: NewPassword })
export const ResetPasswordInput = Schema.Struct({ token: Token, newPassword: NewPassword })
export const ChangePasswordInput = Schema.Struct({ currentPassword: CurrentPassword, newPassword: NewPassword })
export const DeleteAccountInput = Schema.Struct({ password: CurrentPassword })
/** The delete form also needs its confirmation checkbox, which the server function never sees. */
export const DeleteAccountFields = Schema.Struct({
  password: CurrentPassword,
  confirm: Schema.Boolean.check(
    Schema.makeFilter((checked: boolean) => checked, { message: 'Confirm that you want to delete the account.' }),
  ),
})
