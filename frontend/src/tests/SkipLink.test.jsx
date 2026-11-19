import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import SkipLink from '../components/SkipLink'

test('a keyboard user bypasses repeated navigation and continues inside the page', async () => {
  render(<><SkipLink /><nav><a href="/">Home</a><a href="/tutors">Find a Tutor</a></nav><main id="main-content" tabIndex={-1}><h1>Bookings</h1><button>View lesson</button></main></>)
  const user = userEvent.setup()
  const main = screen.getByRole('main')
  const scroll = vi.spyOn(main, 'scrollIntoView')
  await user.tab()
  expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus()
  fireEvent.click(screen.getByRole('link', { name: 'Skip to main content' }))
  expect(main).toHaveFocus()
  expect(scroll).toHaveBeenCalled()
  await user.tab()
  expect(screen.getByRole('button', { name: 'View lesson' })).toHaveFocus()
})
