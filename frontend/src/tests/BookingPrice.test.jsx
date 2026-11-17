import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import api from '../api/client'
import BookLesson from '../pages/parent/BookLesson'
import { BookingPanel } from '../pages/parent/TutorProfile'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../assistant/MatchingContext', () => ({ useMatching: () => ({ kidsLoaded: true, kids: [{ id: 1, name: 'Sarah', educationLevel: 'PRIMARY', grade: 5, subjects: ['Mathematics'] }] }) }))
const kids = [{ id: 1, name: 'Sarah', educationLevel: 'PRIMARY', grade: 5, subjects: ['Mathematics'] }]
const tutor = { id: 2, name: 'Tutor', hourlyRate: 50, rating: 4, reviewCount: 1, subjects: ['Mathematics'], grades: ['Primary 5'], offersOnline: true, offersPhysical: true,
  upcomingAvailability: [{ date: '2027-01-13', slots: [{ start: '17:00', end: '18:00', status: 'available', mode: 'ONLINE' }] }],
}
function Destination() { return <output data-testid="handoff">{JSON.stringify(useLocation().state)}</output> }
async function open(entry) {
  const full = entry === 'full page'
  render(<MemoryRouter initialEntries={[{ pathname: full ? '/parent/tutors/2/book' : '/parent/tutors/2', search: '?mode=ONLINE',
    state: { slots: [{ date: '2027-01-13', start: '17:00', mode: 'ONLINE' }, { date: '2027-01-14', start: '17:00', mode: 'ONLINE' }] },
  }]}><Routes>
    <Route path={full ? '/parent/tutors/:id/book' : '/parent/tutors/:id'} element={full ? <BookLesson /> : <BookingPanel tutor={tutor} kids={kids} />} />
    {!full && <Route path="/parent/tutors/:id/book" element={<Destination />} />}
  </Routes></MemoryRouter>)
  const input = await screen.findByRole('spinbutton', { name: /Proposed Price/ })
  await waitFor(() => expect(input).toHaveValue(50))
  return { input, button: screen.getByRole('button', { name: full ? /Send Booking Request/ : /Continue Booking/ }) }
}
beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation(async url => ({ data: url.endsWith('/slots') ? { days: [] } : { tutor } }))
  api.post.mockResolvedValue({ data: {} })
})

describe.each(['full page', 'profile panel'])('booking price on the %s', entry => {
  test.each([
    ['', 'Enter the proposed price.'], ['0', 'more than RM0'], ['-10', 'more than RM0'],
    ['0.001', 'at least RM0.01'], ['0.000000001', 'at least RM0.01'],
    ['1000.01', 'more than RM1000'], ['50.555', '2 decimal places'], ['1e2', '2 decimal places'],
  ])('invalid price %s shows feedback before submission and blocks the action', async (value, message) => {
    const { input, button } = await open(entry)
    expect(input).toHaveAttribute('min', '0.01')
    expect(input).toHaveAttribute('max', '1000')
    expect(input).toHaveAttribute('step', '0.01')
    fireEvent.change(input, { target: { value } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(expect.stringContaining(message))
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(api.post).not.toHaveBeenCalled()
    expect(screen.queryByTestId('handoff')).not.toBeInTheDocument()
    if (entry === 'full page') {
      expect(screen.getByText('Enter a valid hourly price to calculate the total.')).toBeVisible()
      expect(screen.queryByText(/Proposed total: RM/)).not.toBeInTheDocument()
    }
    fireEvent.change(input, { target: { value: '50.50' } })
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(button).toBeEnabled()
  })
})

test.each([['0.01', '0.02'], ['50.50', '101.00'], ['1000', '2000.00']])('valid hourly price %s submits and totals multiple lessons correctly', async (value, total) => {
  const { input, button } = await open('full page')
  fireEvent.change(input, { target: { value } })
  expect(screen.getByText(`Proposed total: RM${total}. Each lesson is confirmed and paid separately.`)).toBeVisible()
  fireEvent.click(button)
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/parent/bookings', expect.objectContaining({ proposedPrice: Number(value), teachingMode: 'ONLINE', slots: [
    { date: '2027-01-13', startTime: '17:00' }, { date: '2027-01-14', startTime: '17:00' },
  ] })))
})
