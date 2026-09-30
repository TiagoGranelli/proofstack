// ConfirmDeleteButton: Delete asks first in an alert dialog, focus comes back to Delete, and only a confirmation starts
// the deletion, once focus is back. How a feature's delete request behaves is tested with the feature
// (delete-post.test.tsx).
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ConfirmDeleteButton } from '#/components/confirm-delete/confirm-delete-button.tsx'
import { afterRendering, renderInApp } from './test-utils.tsx'

const deleted = { noun: 'note', text: 'The note to delete', consequence: 'It will be gone for good.' }
const deleteButton = () => page.getByRole('button', { name: 'Delete note: The note to delete' })
const dialog = () => page.getByRole('alertdialog', { name: 'Delete this note?' })
const keepIt = () => dialog().getByRole('button', { name: 'Keep it' })
const confirmDelete = () => dialog().getByRole('button', { name: 'Delete', exact: true })

/** Renders the button with a confirmation that records where focus was when it ran. */
const renderButton = async (pending = false) => {
  const focusedOnConfirm: Array<Element | null> = []
  const onConfirm = vi.fn<() => void>(() => void focusedOnConfirm.push(document.activeElement))
  await renderInApp(<ConfirmDeleteButton target={deleted} pending={pending} onConfirm={onConfirm} />)
  return { onConfirm, focusedOnConfirm }
}

describe('ConfirmDeleteButton', () => {
  it('asks first, quoting the item, with focus on Keep it; Keep it puts focus back on Delete', async () => {
    const { onConfirm } = await renderButton()
    ;(deleteButton().element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog()).toHaveAccessibleDescription('It will be gone for good.')
    await expect.element(dialog().getByText('The note to delete')).toBeVisible()
    await expect.element(keepIt()).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog()).not.toBeInTheDocument()
    await expect.element(deleteButton()).toHaveFocus()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('closes on Escape without confirming, focus back on Delete', async () => {
    const { onConfirm } = await renderButton()
    ;(deleteButton().element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(keepIt()).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog()).not.toBeInTheDocument()
    await expect.element(deleteButton()).toHaveFocus()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms once, after focus is back on Delete', async () => {
    const { onConfirm, focusedOnConfirm } = await renderButton()
    await deleteButton().click()
    await confirmDelete().click()
    await expect.poll(() => onConfirm.mock.calls.length).toBe(1)
    await expect.element(dialog()).not.toBeInTheDocument()
    expect(focusedOnConfirm).toEqual([deleteButton().element()])
  })

  it('ignores presses while pending, keeping focus', async () => {
    await renderButton(true)
    await expect.element(deleteButton()).toHaveAttribute('aria-disabled', 'true')
    ;(deleteButton().element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await afterRendering()
    await expect.element(dialog()).not.toBeInTheDocument()
    await expect.element(deleteButton()).toHaveFocus()
  })
})
