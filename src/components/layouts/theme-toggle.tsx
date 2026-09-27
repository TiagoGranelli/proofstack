import { useSyncExternalStore } from 'react'
import { readThemeChoice, saveThemeChoice, subscribeToThemeChoice, type ThemeChoice } from '#/lib/theme.ts'

const CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// The server cannot know the stored choice: SSR and hydration render `system`, the stored one right after.
const onServer = (): ThemeChoice => 'system'

// A radio drawn as a segment: the invisible input covers it, so its focus outline is the segment's. The checked
// segment is raised with a background, which forced colors (Windows High Contrast) replaces; there it takes the
// system's selection colors instead.
const segment =
  'relative rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-xs forced-colors:has-checked:bg-system-highlight forced-colors:has-checked:text-system-highlight-text forced-colors:has-checked:forced-color-adjust-none'

/** System, light or dark. Native radios: arrow keys move the choice, and it applies at once. */
export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribeToThemeChoice, readThemeChoice, onServer)
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="float-left">Theme</legend>
      <div className="flex rounded-lg bg-muted p-0.5">
        {CHOICES.map(({ value, label }) => (
          <label key={value} className={segment}>
            <input
              type="radio"
              name="theme"
              value={value}
              checked={choice === value}
              onChange={() => saveThemeChoice(value)}
              className="absolute inset-0 cursor-pointer appearance-none rounded-md"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
