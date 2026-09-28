import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

/** Where focus goes on a new page: its heading, or the main region of a page without one. */
const focusNewPage = () => {
  const target = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main')
  // Scroll restoration has already placed the page; focusing must not scroll it again.
  target?.focus({ preventScroll: true })
}

/**
 * Does for a client-side navigation what a full page load does for assistive technology: focus moves to the new
 * page's heading instead of staying on a link that may be gone, and screen readers hear the new page's title (and
 * its flash message, if an action left one), politely. TanStack Router 1.170 has neither built in, only scroll
 * restoration. A change of search or hash on the same page (the skip link) is left alone. Mounted once, inside
 * `<main>`, so the live region exists before it changes.
 */
export function RouteAnnouncer() {
  const router = useRouter()
  // `id` changes on every navigation: two pages with the same title are still two announcements.
  const [announcement, setAnnouncement] = useState({ text: '', id: 0 })
  useEffect(
    () =>
      router.subscribe('onRendered', (event) => {
        if (!event.pathChanged) return
        focusNewPage()
        // The flash message on screen (FlashMessage), read from the page: by now it may be gone from the location.
        const flash = document.querySelector('main [data-flash]')?.textContent
        const text = [document.title, flash].filter(Boolean).join('. ')
        setAnnouncement((previous) => ({ text, id: previous.id + 1 }))
      }),
    [router],
  )
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      <span key={announcement.id}>{announcement.text}</span>
    </div>
  )
}
