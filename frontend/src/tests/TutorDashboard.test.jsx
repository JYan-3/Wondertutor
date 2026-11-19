import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: () => 'Unable to load your dashboard' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { fullName: 'Aiman' } }) }))

import api from '../api/client'
import TutorDashboard from '../pages/tutor/Dashboard'

const show = () => render(<MemoryRouter><TutorDashboard /></MemoryRouter>)
const overview = { newRequests: 3, upcomingSessions: 7, ratingAvg: 4.75, ratingCount: 2 }

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

test('shows the tutor overview and links to teaching tools', async () => {
  api.get.mockResolvedValue({ data: overview })
  show()
  expect(await screen.findByText('4.8 / 5')).toBeInTheDocument()
  expect(screen.getByText(/could only load your totals/)).toBeVisible()
  expect(screen.queryByText('No upcoming confirmed lessons.')).not.toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('7')).toBeInTheDocument()
  expect(screen.getByText('2 parent reviews')).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith('/tutor/dashboard')
  await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' }))
  expect(screen.getByRole('link', { name: /Set teaching hours/ })).toHaveAttribute('href', '/tutor/availability')
  expect(screen.getByRole('link', { name: /Edit my profile/ })).toHaveAttribute('href', '/tutor/setup')
})

test('shows an honest empty rating before the first review', async () => {
  api.get.mockResolvedValue({ data: { ...overview, ratingAvg: 0, ratingCount: 0 } })
  show()
  expect(await screen.findByText('No reviews yet')).toBeInTheDocument()
  expect(screen.queryByText('0.0 / 5')).not.toBeInTheDocument()
})

test('lets the tutor retry a failed dashboard request', async () => {
  api.get.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({ data: overview })
  show()
  expect(await screen.findByText('Unable to load your dashboard')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
  expect(await screen.findByText('4.8 / 5')).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledTimes(2)
})

test('shows the next confirmed lesson with Malaysia time and its booking action', async () => {
  const lesson = { ref: 'abc', subject: 'Mathematics', student: 'Alya', startAt: '2027-01-04T06:00:00Z', endAt: '2027-01-04T07:00:00Z', action: 'Add class link', to: '/tutor/bookings?booking=abc&action=link' }
  api.get.mockResolvedValue({ data: { ...overview, nextLesson: lesson, todaySessions: [lesson], actions: [] } })
  show()
  expect(await screen.findAllByText('Alya · Mathematics')).toHaveLength(2)
  expect(screen.getAllByText(/2:00 PM – 3:00 PM/)).toHaveLength(2)
  expect(screen.getAllByRole('link', { name: 'Add class link' })[0]).toHaveAttribute('href', lesson.to)
})


test('continues from the latest completed report, excluding disputed reports', async () => {
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/tutor/bookings' ? { bookings: [
    { id: 1, status: 'COMPLETED', startAt: '2026-01-01', child: { name: 'Alya' }, subject: 'Maths', report: { homework: 'Older homework' } },
    { id: 2, publicId: 'latest-report', status: 'COMPLETED', startAt: '2026-01-02', child: { name: 'Alya' }, subject: 'Maths', report: { progressNote: 'Equivalent fractions', homework: 'Questions 1–5' } },
    { id: 3, status: 'DISPUTED', startAt: '2026-01-03', child: { name: 'Ben' }, subject: 'Maths', report: { homework: 'Disputed homework' } },
  ] } : { ...overview, nextLesson: null, todaySessions: [], actions: [] } }))
  show()
  expect(await screen.findByText('Equivalent fractions')).toBeVisible()
  expect(screen.getByText('Homework:').parentElement).toHaveTextContent('Questions 1–5')
  expect(screen.getByRole('link', { name: /View lesson report/ })).toHaveAttribute('href', '/tutor/bookings/latest-report/session')
  expect(screen.queryByText('Older homework')).toBeNull()
  expect(screen.queryByText('Disputed homework')).toBeNull()
})
