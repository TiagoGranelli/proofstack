// Keyboard use of the actions on a page: editing works from the keyboard and puts focus back; publishing, saving and
// deleting are announced; alerts and status messages appear where the design says. The Tab order of every page is
// in keyboard.spec.ts. Pointer-free, so skipped on touch projects.
import { dashboardWithMyPost, expect, failServerFunctionPosts, signIn, test, visit } from './support/app.ts'

test.skip(({ isMobile }) => isMobile, 'keyboard navigation is a desktop concern')

test.describe('editing from the keyboard', () => {
  test('Enter on Edit focuses the draft; Escape cancels and puts focus back on Edit', async ({ page, author }) => {
    const { body, post, edit } = await dashboardWithMyPost(page, author)
    await edit.focus()
    await page.keyboard.press('Enter')
    const field = page.getByLabel('Edit post')
    await expect(field).toBeFocused()
    await page.keyboard.type(' (discarded)')
    await page.keyboard.press('Escape')
    await expect(field).toHaveCount(0)
    await expect(edit).toBeFocused()
    // The post's body is its first paragraph; what a feature adds under it comes later.
    await expect(post.locator('p').first()).toHaveText(body)
  })

  test('Save from the keyboard announces it and returns focus to Edit', async ({ page, author }) => {
    const { body, edit } = await dashboardWithMyPost(page, author)
    await edit.focus()
    await page.keyboard.press('Enter')
    // The editor loads on demand (from the focus on Edit): type once it has the caret, as a user would.
    await expect(page.getByLabel('Edit post')).toBeFocused()
    await page.keyboard.type(' (saved)')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Save' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Post saved.')
    const saved = page
      .getByTestId('my-posts')
      .locator(':scope > li')
      .filter({ hasText: `${body} (saved)` })
    await expect(saved.getByRole('button', { name: /^Edit/ })).toBeFocused()
  })

  test('a rejected save is an alert inside the form that also describes the draft', async ({ page, author }) => {
    const { edit } = await dashboardWithMyPost(page, author)
    await edit.click()
    const field = page.getByLabel('Edit post')
    await field.fill('x'.repeat(281))
    await page.getByRole('button', { name: 'Save' }).press('Enter')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Use at most 280 characters')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription(/Over the 280-character limit\..*Use at most 280 characters/)
    // Refused before sending, and focus is on the draft to fix.
    await expect(field).toBeFocused()
  })
})

test.describe('announcements', () => {
  test('publishing is announced and puts focus back in the empty composer', async ({ page, author }) => {
    await dashboardWithMyPost(page, author)
    await expect(page.getByRole('status')).toHaveText('Post published.')
    await expect(page.getByLabel('New post')).toBeFocused()
    await expect(page.getByLabel('New post')).toHaveValue('')
  })

  test('deleting asks first, is announced, and then moves focus to the list heading', async ({ page, author }) => {
    const { post } = await dashboardWithMyPost(page, author)
    await post.getByRole('button', { name: /^Delete post/ }).focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('alertdialog', { name: 'Delete this post?' })
    await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(post).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Published' })).toBeFocused()
    await expect(page.getByRole('status')).toHaveText('Post deleted.')
  })

  test('a failed sign-in is an alert that describes the form, and focus stays in the form', async ({ page }) => {
    await visit(page, '/login')
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('nobody@example.test')
    await page.getByLabel('Password').fill('not the password at all')
    await page.keyboard.press('Enter')
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(page.locator('form')).toHaveAccessibleDescription(await alert.innerText())
    await expect(page.getByLabel('Password')).toBeFocused()
  })

  test('a failed sign-out is an alert, and the button can be used again from the keyboard', async ({
    page,
    author,
  }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    const restore = await failServerFunctionPosts(page)
    const signOut = page.getByRole('button', { name: 'Sign out' })
    await signOut.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toHaveText('Could not sign out. Check your connection and try again.')
    await expect(signOut).toBeEnabled()
    await restore()
    await signOut.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/$/)
  })
})
