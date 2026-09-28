import { useLocation, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { flashMessage } from '#/lib/flash.ts'

/**
 * The one-time message an action left for this page (src/lib/flash.ts), such as "You are signed out." It is not
 * a live region: RouteAnnouncer reads it out (`data-flash`) with the page title when the page opens. Once shown it
 * is dropped from the history entry, so it stays until the next navigation, and a reload or a return to the entry
 * does not show it again (nor render it during hydration, which the server could not match).
 */
export function FlashMessage() {
  const router = useRouter()
  const pathname = useLocation({ select: (location) => location.pathname })
  // The page this instance belongs to. While a navigation loads, the old page is still on screen but the location
  // is already the new one: its flash is for the page that comes, not for this one.
  const [ownPath] = useState(pathname)
  const flash = useLocation({
    select: (location) => (location.pathname === ownPath ? location.state.flash : undefined),
  })
  // Kept apart from the location: dropping the flash from the entry below must not take the message off screen.
  // A new flash (another action, same page) replaces it; React's pattern for state that follows a changing value.
  const [message, setMessage] = useState(() => flashMessage(flash))
  const [seen, setSeen] = useState(flash)
  if (flash !== seen) {
    setSeen(flash)
    if (flash) setMessage(flashMessage(flash))
  }
  useEffect(() => {
    if (!flash) return
    const { flash: _shown, ...state } = router.history.location.state
    router.history.replace(router.history.location.href, state)
  }, [flash, router])
  if (!message || pathname !== ownPath) return null
  return (
    <p data-flash data-testid="flash" className="rounded-lg border bg-muted/60 px-4 py-3 text-sm">
      {message}
    </p>
  )
}
