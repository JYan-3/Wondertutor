import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import AudienceGuide from '../pages/AudienceGuide'
import HowItWorks from '../pages/HowItWorks'

let auth = { user: null }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
beforeEach(() => { auth = { user: null } })

test('a parent guide lets guests browse tutors before account creation', async () => {
  render(<MemoryRouter><Routes>
    <Route path="/" element={<AudienceGuide audience="parents" />} />
    <Route path="/tutors" element={<h1>Public tutor catalogue</h1>} />
  </Routes></MemoryRouter>)
  expect(document.title).toBe('For Parents | WonderTutor')
  expect(screen.getByRole('link', { name: 'Create a parent account' })).toHaveAttribute('href', '/signup?role=PARENT')
  await userEvent.click(screen.getAllByRole('link', { name: 'Find a Tutor' })[0])
  expect(screen.getByRole('heading', { name: 'Public tutor catalogue' })).toBeInTheDocument()
})

test('a tutor guide sends guests to tutor sign-up and keeps verification guidance available', async () => {
  render(<MemoryRouter><AudienceGuide audience="tutors" /></MemoryRouter>)
  expect(document.title).toBe('For Tutors | WonderTutor')
  expect(screen.getAllByRole('link', { name: 'Become a Tutor' })[0]).toHaveAttribute('href', '/signup?role=TUTOR')
  const question = screen.getByText('How do I get a verified badge?').closest('details')
  await userEvent.click(within(question).getByText('How do I get a verified badge?'))
  expect(question).toHaveAttribute('open')
  expect(question).toHaveTextContent('identity and qualification approvals')
})

test('signed-in tutors can continue setup instead of being sent back to sign-up', () => {
  auth = { user: { role: 'TUTOR' } }
  render(<MemoryRouter><AudienceGuide audience="tutors" /></MemoryRouter>)
  expect(screen.getAllByRole('link', { name: 'Edit my tutor profile' })[0]).toHaveAttribute('href', '/tutor/setup')
  expect(screen.getByRole('link', { name: 'Manage my availability' })).toHaveAttribute('href', '/tutor/availability')
  expect(screen.queryByRole('link', { name: 'Become a Tutor' })).not.toBeInTheDocument()
})

test('an existing parent reading the tutor guide retains the parent account destination', () => {
  auth = { user: { role: 'PARENT' } }
  render(<MemoryRouter><AudienceGuide audience="tutors" /></MemoryRouter>)
  expect(screen.getAllByRole('link', { name: 'My Dashboard' })[0]).toHaveAttribute('href', '/parent')
  expect(screen.queryByRole('link', { name: 'Become a Tutor' })).not.toBeInTheDocument()
})

test('How It Works switches roles and the next action without requiring login', async () => {
  render(<MemoryRouter><HowItWorks /></MemoryRouter>)
  const parents = screen.getByRole('button', { name: 'For Parents' })
  const tutors = screen.getByRole('button', { name: 'For Tutors' })
  expect(parents).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('link', { name: 'Find a Tutor' })).toHaveAttribute('href', '/tutors')
  await userEvent.click(tutors)
  expect(tutors).toHaveAttribute('aria-pressed', 'true')
  expect(parents).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('list')).toHaveTextContent('Create your tutor account')
  expect(screen.getByRole('link', { name: 'Become a Tutor' })).toHaveAttribute('href', '/signup?role=TUTOR')
  expect(screen.getByRole('link', { name: 'Read the tutor guide' })).toHaveAttribute('href', '/for-tutors')
})
