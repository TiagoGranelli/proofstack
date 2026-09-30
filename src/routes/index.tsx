import { createFileRoute } from '@tanstack/react-router'
import { WordCounter } from '../components/word-counter.tsx'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Word counter</h1>
      <p className="mt-2 mb-6 text-neutral-700 dark:text-neutral-300">Type or paste text below to count its words.</p>
      <WordCounter />
    </>
  )
}
