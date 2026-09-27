import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * What an account form shows once it succeeded, in place of (or next to) the form. The submit button the user
 * pressed is gone, so focus would fall back to <body> and a keyboard user would start again from the top of
 * the page: the message takes focus when it appears instead. It is a status (live region) named by its
 * heading, so a screen reader announces the heading on focus and reads the text after it.
 */
export function AuthStatus(props: { title: string; headingLevel?: 2 | 3; children: ReactNode }) {
  const ref = useRef<HTMLOutputElement>(null)
  const titleId = useId()
  const Heading = props.headingLevel === 3 ? 'h3' : 'h2'
  useEffect(() => ref.current?.focus(), [])
  return (
    <output ref={ref} tabIndex={-1} aria-labelledby={titleId} className="grid gap-1 outline-none">
      <Heading id={titleId} className="font-semibold">
        {props.title}
      </Heading>
      <p>{props.children}</p>
    </output>
  )
}
