import { cn } from 'cn'
import * as React from 'react'

// Trimmed from radix-nova: no file-input styles (no file inputs here), and an invalid field is its full destructive
// border, without the tinted ring (a box shadow, gone in forced colors) or the dark theme's half-strength border.
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors placeholder:text-muted-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
