import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import PublicLayout from '../layouts/PublicLayout'

let auth = { user: null }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

function setup(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<PublicLayout />}>
    <Route path="/" element={<h1>Home content</h1>} />
    <Route path="/for-parents" element={<h1>Parent guide content</h1>} />
    <Route path="/for-tutors" element={<h1>Tutor guide content</h1>} />
    <Route path="/how-it-works" element={<h1>How it works content</h1>} />
    <Route path="/faq" element={<h1>FAQ content</h1>} />
  </Route></Routes></MemoryRouter>)
}

beforeEach(() => {
  auth = { user: null }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

test('parent and tutor links open separate pages and Support owns How It Works and FAQ', async () => {
  setup()
  const main = within(screen.getByRole('navigation', { name: 'Main' }))
  expect(main.getByRole('link', { name: 'For Parents' })).toHaveAttribute('href', '/for-parents')
  expect(main.getByRole('link', { name: 'For Tutors' })).toHaveAttribute('href', '/for-tutors')
  expect(main.queryByRole('link', { name: 'About Us' })).not.toBeInTheDocument()
  expect(main.queryByRole('link', { name: 'How It Works' })).not.toBeInTheDocument()
  await userEvent.click(main.getByRole('button', { name: 'Support' }))
  await userEvent.click(main.getByRole('link', { name: /How It Works/ }))
  expect(screen.getByRole('heading', { name: 'How it works content' })).toBeInTheDocument()
  const next = within(screen.getByRole('navigation', { name: 'Main' }))
  expect(next.getByRole('button', { name: 'Support' })).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(next.getByRole('button', { name: 'Support' }))
  expect(next.getByRole('link', { name: /How It Works/ })).toHaveAttribute('aria-current', 'page')
  expect(next.getByRole('link', { name: /FAQ/ })).toHaveAttribute('href', '/faq')
  expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0)
})

test('Support works with Enter, Tab and Escape, and closes outside or when focus leaves', async () => {
  setup()
  const nav = within(screen.getByRole('navigation', { name: 'Main' }))
  const support = nav.getByRole('button', { name: 'Support' })
  support.focus()
  await userEvent.keyboard('{Enter}')
  await userEvent.tab()
  expect(nav.getByRole('link', { name: /How It Works/ })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(support).toHaveFocus()
  expect(support).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(support)
  await userEvent.click(screen.getByRole('heading', { name: 'Home content' }))
  expect(support).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(support)
  await userEvent.tab()
  await userEvent.tab()
  await userEvent.tab()
  expect(support).toHaveAttribute('aria-expanded', 'false')
})

test('mobile navigation closes after following a guide or a Support link', async () => {
  setup()
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Mobile' })).getByRole('link', { name: 'For Tutors' }))
  expect(screen.getByRole('heading', { name: 'Tutor guide content' })).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'For Tutors' })).toHaveAttribute('aria-current', 'page')
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  const mobile = within(screen.getByRole('navigation', { name: 'Mobile' }))
  await userEvent.click(mobile.getByRole('button', { name: 'Support' }))
  await userEvent.click(mobile.getByRole('link', { name: /FAQ/ }))
  expect(screen.getByRole('heading', { name: 'FAQ content' })).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument()
})

test('Escape dismisses the mobile disclosure before the menu and restores focus', async () => {
  setup()
  const menu = screen.getByRole('button', { name: 'Open menu' })
  await userEvent.click(menu)
  const mobile = within(screen.getByRole('navigation', { name: 'Mobile' }))
  const support = mobile.getByRole('button', { name: 'Support' })
  await userEvent.click(support)
  await userEvent.tab()
  await userEvent.keyboard('{Escape}')
  expect(support).toHaveFocus()
  expect(screen.getByRole('navigation', { name: 'Mobile' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument()
  expect(menu).toHaveFocus()
})

test.each(['PARENT', 'TUTOR', 'ADMIN'])('signed-in %s readers keep their own dashboard link', role => {
  auth = { user: { role } }
  setup('/for-parents')
  const header = within(screen.getByRole('banner'))
  expect(header.getByRole('link', { name: 'My Dashboard' })).toHaveAttribute('href', `/${role.toLowerCase()}`)
  expect(header.queryByRole('link', { name: 'Log In' })).not.toBeInTheDocument()
})
