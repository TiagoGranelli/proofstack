import { createContext } from 'react'

/**
 * What the server said about individual fields of the form around it, by field name (`{ currentPassword: 'That
 * password is not correct.' }`). The form's field components (./fields.tsx) show an issue for their field like
 * one of their own errors: next to the field, which is then invalid and described by it. Empty by default.
 */
export const ServerIssues = createContext<Readonly<Record<string, string>>>({})
