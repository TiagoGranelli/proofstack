/** The visitor's theme: `system` follows `prefers-color-scheme`; the others are a choice kept in localStorage. */
export type ThemeChoice = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'

/**
 * Applies a stored choice to `<html data-theme>` before the first paint, so a visitor who chose a theme never sees
 * the other one flash. The root route puts it in `<head>` through `head()`: on SSR pages the router adds the CSP
 * nonce, and the prerendered pages' policy lists its hash (vite.config.ts). It runs before the stylesheet applies,
 * so it stays one line with no dependencies. Without a stored choice it does nothing and CSS follows the system.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

const isStoredChoice = (value: string | null): value is 'light' | 'dark' => value === 'light' || value === 'dark'

/** The stored choice, or `system`. Storage can be unavailable (private modes, blocked cookies): then `system`. */
export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isStoredChoice(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

const listeners = new Set<() => void>()

const applyThemeChoice = (choice: ThemeChoice) => {
  if (choice === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = choice
}

/** Stores `choice` and applies it at once, as THEME_SCRIPT does on the next load. */
export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Not persisted; the choice still applies to this page.
  }
  applyThemeChoice(choice)
  for (const listener of listeners) listener()
}

/**
 * For `useSyncExternalStore`: calls `listener` when the choice changes here or in another tab (the `storage`
 * event), whose change it applies to this page too.
 */
export function subscribeToThemeChoice(listener: () => void): () => void {
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    applyThemeChoice(readThemeChoice())
    listener()
  }
  listeners.add(listener)
  addEventListener('storage', fromOtherTab)
  return () => {
    listeners.delete(listener)
    removeEventListener('storage', fromOtherTab)
  }
}
