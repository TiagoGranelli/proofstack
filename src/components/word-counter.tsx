import { useId, useState } from 'react'
import { countWords } from '../lib/count-words.ts'

/** A text field that says how many words it holds. The count is a status, so screen readers announce changes. */
export function WordCounter() {
  const [text, setText] = useState('')
  const fieldId = useId()
  const count = countWords(text)
  return (
    <div className="grid gap-2">
      <label htmlFor={fieldId} className="font-medium">
        Your text
      </label>
      <textarea
        id={fieldId}
        rows={6}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="rounded-md border border-neutral-500 bg-transparent p-2"
      />
      <div className="flex items-center justify-between">
        <output htmlFor={fieldId}>
          {count} {count === 1 ? 'word' : 'words'}
        </output>
        <button
          type="button"
          onClick={() => setText('')}
          className="rounded-md border border-neutral-500 px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Clear
        </button>
      </div>
    </div>
  )
}
