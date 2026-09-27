A user reports:

> I pasted a post of exactly 280 characters into the composer on the dashboard. The counter says 280/280, but the
> field turns red and a screen reader announces "Over the 280-character limit". The same happens in the post
> editor. When I publish anyway, the server accepts it. My paste ends with a newline.

Find the cause and fix it.

## Acceptance criteria

- A draft whose trimmed length is at most the limit is not flagged, in the composer and in the post editor,
  whatever whitespace surrounds it. A draft whose trimmed length is over the limit is still flagged.
- A test that would have caught the bug.
- `pnpm check` passes.
