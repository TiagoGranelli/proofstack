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

/** The stored choice, or `system`. Storage can be unavailable (private modes, blocked cookies): then `system`. */
export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

/** Stores `choice` and applies it at once, as THEME_SCRIPT does on the next load. */
export function saveThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Not persisted; the choice still applies to this page.
  }
  if (choice === 'system') delete root.dataset.theme
  else root.dataset.theme = choice
}
