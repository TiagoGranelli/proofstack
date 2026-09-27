import { useState } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import { useCreatePost } from '#/features/posts/api/create-post.ts'
import { CharacterCount, isTooLong } from '#/features/posts/components/character-count.tsx'

export function PostComposer(props: { onPublished?: () => void }) {
  const [body, setBody] = useState('')
  const create = useCreatePost({
    mutationConfig: {
      onSuccess: () => {
        setBody('')
        props.onPublished?.()
      },
    },
  })
  return (
    <form
      className="grid gap-2"
      aria-busy={create.isPending}
      onSubmit={(event) => {
        event.preventDefault()
        // The API rejects bodies over the limit; its ValidationError is shown below rather than
        // truncating input the author may still want to trim.
        create.mutate({ body: { body: body.trim() } })
      }}
    >
      <Label htmlFor="post-body">New post</Label>
      <Textarea
        id="post-body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        aria-describedby={create.isError ? 'post-body-count post-body-error' : 'post-body-count'}
        aria-invalid={isTooLong(body) || create.isError || undefined}
        required
      />
      <div className="flex items-center justify-between gap-2">
        <CharacterCount id="post-body-count" value={body} />
        <Button type="submit" disabled={create.isPending || body.trim().length === 0}>
          Publish
        </Button>
      </div>
      {create.isError ? <ApiErrorAlert id="post-body-error" error={create.error} action="publish the post" /> : null}
    </form>
  )
}
