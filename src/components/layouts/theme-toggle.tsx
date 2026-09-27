import { useEffect, useRef } from 'react'
import { readThemeChoice, saveThemeChoice, type ThemeChoice } from '#/lib/theme.ts'

const CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// A radio drawn as a segment: the invisible input covers it, so its focus outline is the segment's. The checked
// segment is raised with a background, which forced colors (Windows High Contrast) replaces; there it takes the
// system's selection colors instead.
const segment =
  'relative rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-xs forced-colors:has-checked:bg-system-highlight forced-colors:has-checked:text-system-highlight-text forced-colors:has-checked:forced-color-adjust-none'

/**
 * System, light or dark. Native radios, left to the browser (uncontrolled): arrow keys move the choice and it
 * applies at once. The server cannot know the stored choice, so it renders System; the stored one is checked once
 * hydrated.
 */
export function ThemeToggle() {
  const group = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const stored = group.current?.querySelector<HTMLInputElement>(`input[value="${readThemeChoice()}"]`)
    if (stored) stored.checked = true
  }, [])
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="float-left">Theme</legend>
      <div ref={group} className="flex rounded-lg bg-muted p-0.5">
        {CHOICES.map(({ value, label }) => (
          <label key={value} className={segment}>
            <input
              type="radio"
              name="theme"
              value={value}
              defaultChecked={value === 'system'}
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
