/**
 * One-time messages for the page an action redirects to, such as "You are signed out." on `/` after signing out.
 * The action passes a code in the router's history state (`navigate({ to: '/', state: { flash: 'signed-out' } })`),
 * not in the URL, so it cannot be linked to or bookmarked. `FlashMessage` shows it under the page heading, then
 * drops it from the history entry, and `RouteAnnouncer` reads it out with the page title.
 */
export const FLASH_MESSAGES = {
  'signed-out': 'You are signed out.',
  'signed-out-everywhere': 'You are signed out on every device.',
  'account-deleted': 'Your account and everything in it are deleted.',
  'password-reset': 'Your password is changed, and every session was signed out. Sign in with the new password.',
} as const

type Flash = keyof typeof FLASH_MESSAGES

declare module '@tanstack/react-router' {
  interface HistoryState {
    flash?: Flash
  }
}

const isFlash = (value: unknown): value is Flash => typeof value === 'string' && Object.hasOwn(FLASH_MESSAGES, value)

/** The message of a history entry's flash code; nothing for a missing or unknown one (state is not trusted). */
export function flashMessage(flash: unknown): string | undefined {
  return isFlash(flash) ? FLASH_MESSAGES[flash] : undefined
}
