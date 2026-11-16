import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import VisitorWelcome from '../components/VisitorWelcome'

let auth = { user: null, loading: false, sessionError: '' }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

function setup() {
  return render(<MemoryRouter><Routes>
    <Route path="/" element={<><VisitorWelcome /><label>Search subjects<input /></label></>} />
    <Route path="/for-parents" element={<><h1>Parent guide</h1><Link to="/">Back home</Link></>} />
    <Route path="/for-tutors" element={<><h1>Tutor guide</h1><Link to="/">Back home</Link></>} />
  </Routes></MemoryRouter>)
}

beforeEach(() => {
  auth = { user: null, loading: false, sessionError: '' }
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

test.each([
  ["I'm a Parent", 'PARENT', 'Parent guide'],
  ["I'm a Tutor", 'TUTOR', 'Tutor guide'],
])('%s opens the public guide and is remembered for the visit without changing the account', async (label, choice, heading) => {
  setup()
  const dialog = screen.getByRole('dialog', { name: 'Welcome to WonderTutor' })
  await userEvent.click(within(dialog).getByRole('link', { name: label }))
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  expect(sessionStorage.getItem('wt-visitor-choice')).toBe(choice)
  expect(auth.user).toBeNull()
  await userEvent.click(screen.getByRole('link', { name: 'Back home' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('Just Looking leaves the homepage usable and survives a reload', async () => {
  const view = setup()
  await userEvent.click(screen.getByRole('button', { name: 'Just Looking' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Search subjects'), 'Maths')
  expect(screen.getByLabelText('Search subjects')).toHaveValue('Maths')
  expect(sessionStorage.getItem('wt-visitor-choice')).toBe('BROWSE')
  view.unmount()
  setup()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('keyboard focus stays in the dialog and Escape dismisses it and unlocks scrolling', async () => {
  setup()
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement)
  expect(document.body.style.overflow).toBe('hidden')
  screen.getByRole('button', { name: 'Just Looking' }).focus()
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  await userEvent.tab({ shift: true })
  expect(screen.getByRole('button', { name: 'Just Looking' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.body.style.overflow).not.toBe('hidden')
  expect(sessionStorage.getItem('wt-visitor-choice')).toBe('BROWSE')
})

test('the close button also lets visitors browse', async () => {
  setup()
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(sessionStorage.getItem('wt-visitor-choice')).toBe('BROWSE')
})

test('clicking the backdrop dismisses the welcome without requiring an account', () => {
  setup()
  fireEvent.mouseDown(screen.getByRole('dialog').parentElement)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test.each(['PARENT', 'TUTOR', 'ADMIN'])('signed-in %s visitors are not prompted', role => {
  auth = { user: { role }, loading: false, sessionError: '' }
  setup()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(sessionStorage.getItem('wt-visitor-choice')).toBeNull()
})

test('session loading cannot briefly prompt an already signed-in visitor', () => {
  auth.loading = true
  const { rerender } = render(<MemoryRouter><VisitorWelcome /></MemoryRouter>)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  auth = { user: { role: 'TUTOR' }, loading: false, sessionError: '' }
  rerender(<MemoryRouter><VisitorWelcome /></MemoryRouter>)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('an unavailable session check does not treat the visitor as a confirmed guest', () => {
  auth.sessionError = 'Unable to check your account.'
  setup()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('storage restrictions do not trap a visitor in the welcome', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled') })
  setup()
  await userEvent.click(screen.getByRole('button', { name: 'Just Looking' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Search subjects')).toBeEnabled()
})
