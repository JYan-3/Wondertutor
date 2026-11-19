import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import ParentDashboard from '../pages/parent/Dashboard'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, fullName: 'Test Parent' } }) }))
vi.mock('../assistant/MatchingContext', () => ({ useMatching: () => ({ setChatOpen: vi.fn(), setResult: vi.fn() }) }))
const child = { id: 1, name: 'Sarah', educationLevel: 'PRIMARY', grade: 5, subjects: ['English'] }
const tutor = { id: 2, name: 'Aishah Rahman', rating: 4.8, reviewCount: 10, verified: true }
const lesson = { id: 3, subject: 'English', tutor, child, status: 'CONFIRMED', teachingMode: 'ONLINE', createdAt: '2029-12-01T09:00:00Z', startAt: '2030-01-01T09:00:00Z', endAt: '2030-01-01T10:00:00Z', proposedPrice: 55, agreedPrice: 55 }
let data
beforeEach(() => {
  data = { children: [child], counts: { upcoming: 3, pending: 0, completed: 0, needsAttention: 0 }, upcoming: [lesson, { ...lesson, id: 4, subject: 'Mathematics' }, { ...lesson, id: 5, subject: 'Science' }], activity: [] }
  api.get.mockImplementation(async path => ({ data: path === '/parent/dashboard' ? data : { matching: null } }))
})
const open = () => render(<MemoryRouter><ParentDashboard /></MemoryRouter>)

test('upcoming lessons are encountered before tutor discovery and children, with a route to the full schedule', async () => {
  open()
  const upcoming = await screen.findByRole('heading', { name: 'Upcoming Lessons' })
  const find = screen.getByRole('heading', { name: 'Find a Tutor' })
  expect(upcoming.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'View Lesson Details' })).toHaveLength(2)
  expect(screen.getByText(/Showing your next two lessons/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View all upcoming' })).toHaveAttribute('href', '/parent/bookings?tab=upcoming')
})

test('each primary lesson action opens the matching lesson details without mixing tutors or subjects', async () => {
  open()
  const buttons = await screen.findAllByRole('button', { name: 'View Lesson Details' })
  fireEvent.click(buttons[1])
  const dialog = screen.getByRole('dialog', { name: 'Mathematics' })
  expect(within(dialog).getByText('Aishah Rahman')).toBeVisible()
  expect(within(dialog).getByText(/Sarah/)).toBeVisible()
})

test('a parent with no lessons sees tutor discovery first and a useful empty state', async () => {
  data = { ...data, upcoming: [], counts: { ...data.counts, upcoming: 0 } }
  open()
  const find = await screen.findByRole('heading', { name: 'Find a Tutor' })
  const upcoming = screen.getByRole('heading', { name: 'Upcoming Lessons' })
  expect(find.compareDocumentPosition(upcoming) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText(/No upcoming lessons yet/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'View Lesson Details' })).not.toBeInTheDocument()
})
