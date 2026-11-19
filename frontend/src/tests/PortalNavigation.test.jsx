import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import AppLayout from '../layouts/AppLayout'

let sessionUser
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: sessionUser }) }))
vi.mock('../api/client', () => ({
  default: { get: async () => ({ data: { unread: 0, notifications: [], children: [] } }) },
}))

function CurrentPage() {
  const { pathname } = useLocation()
  return <h1>{pathname}</h1>
}

test.each([
  ['PARENT', 'Saved Tutors', '/parent/favourites'],
  ['TUTOR', 'Availability', '/tutor/availability'],
  ['ADMIN', 'Settings', '/admin/settings'],
])('the %s mobile menu exposes its destinations and closes on navigation', async (role, label, destination) => {
  sessionUser = { id: 1, role, fullName: 'Test User' }
  const base = '/' + role.toLowerCase()
  render(<MemoryRouter initialEntries={[base]}><Routes>
    <Route element={<AppLayout />}><Route path="*" element={<CurrentPage />} /></Route>
  </Routes></MemoryRouter>)

  const primaryLinks = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')
  const accountLinks = within(screen.getByRole('navigation', { name: 'Account' })).queryAllByRole('link')
  const expected = new Set([...primaryLinks, ...accountLinks].map(link => link.getAttribute('href')))
  const user = userEvent.setup()
  const openMenu = () => user.click(screen.getByRole('button', { name: /^open menu$/i }))
  await openMenu()
  const menu = within(screen.getByRole('navigation', { name: 'Portal menu' }))
  const destinations = menu.getAllByRole('link').map(link => link.getAttribute('href'))
  expect(destinations.sort()).toEqual([...expected].sort())
  expect(menu.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  await user.click(menu.getByRole('link', { name: label }))
  expect(screen.getByRole('heading', { name: destination })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await openMenu()
  const reopened = within(screen.getByRole('navigation', { name: 'Portal menu' }))
  expect(reopened.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  expect(reopened.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
})
