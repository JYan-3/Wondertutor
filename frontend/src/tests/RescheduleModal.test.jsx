import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: (e) => e.message }))
import api from '../api/client'
import RescheduleModal from '../components/RescheduleModal'

const booking = { id: 5, tutor: { id: 2, name: 'Ms. Lee' }, teachingMode: 'ONLINE', startAt: '2026-10-19T08:00:00.000Z', endAt: '2026-10-19T09:00:00.000Z' }
const days = [
  { date: '2026-10-20', dow: 2, slots: [{ start: '16:00', end: '17:00', status: 'unavailable' }, { start: '17:00', end: '18:00', status: 'available' }] },
  { date: '2026-10-21', dow: 3, slots: [{ start: '16:00', end: '17:00', status: 'unavailable' }] },
]

describe('reschedule dialog', () => {
  test('offers only the tutor free times and sends the chosen one with the reason', async () => {
    api.get.mockResolvedValue({ data: { days } })
    const onSubmit = vi.fn().mockResolvedValue(null)
    render(<RescheduleModal booking={booking} onClose={() => {}} onSubmit={onSubmit} />)
    expect(await screen.findByRole('button', { name: '5:00 PM' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '4:00 PM' })).not.toBeInTheDocument() // taken
    expect(screen.getByRole('button', { name: 'Send Request' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '5:00 PM' }))
    await userEvent.type(screen.getByLabelText(/Reason for the tutor/), 'School event')
    await userEvent.click(screen.getByRole('button', { name: 'Send Request' }))
    expect(onSubmit).toHaveBeenCalledWith({ date: '2026-10-20', startTime: '17:00', reason: 'School event' })
  })

  test('shows the server problem inside the dialog', async () => {
    api.get.mockResolvedValue({ data: { days } })
    render(<RescheduleModal booking={booking} onClose={() => {}} onSubmit={async () => 'That time slot has just been taken.'} />)
    await userEvent.click(await screen.findByRole('button', { name: '5:00 PM' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send Request' }))
    expect(await screen.findByText('That time slot has just been taken.')).toBeInTheDocument()
  })

  test('says so when the tutor has no free time that week', async () => {
    api.get.mockResolvedValue({ data: { days: [days[1]] } })
    render(<RescheduleModal booking={booking} onClose={() => {}} onSubmit={vi.fn()} />)
    expect(await screen.findByText(/No free times this week/)).toBeInTheDocument()
  })

  test.each(['ONLINE', 'PHYSICAL'])('offers only compatible hours for a %s lesson', async teachingMode => {
    api.get.mockResolvedValue({ data: { days: [{ date: '2026-10-20', slots: [
      { start: '16:00', end: '17:00', status: 'available', mode: teachingMode === 'ONLINE' ? 'PHYSICAL' : 'ONLINE' },
      { start: '17:00', end: '18:00', status: 'available', mode: teachingMode },
      { start: '18:00', end: '19:00', status: 'available', mode: 'BOTH' },
    ] }] } })
    render(<RescheduleModal booking={{ ...booking, teachingMode }} onClose={() => {}} onSubmit={vi.fn()} />)
    expect(await screen.findByRole('button', { name: '5:00 PM' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '6:00 PM' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '4:00 PM' })).not.toBeInTheDocument()
  })

  test('a week with hours only for another teaching mode has no selectable times', async () => {
    api.get.mockResolvedValue({ data: { days: [{ date: '2026-10-20', slots: [{ start: '17:00', end: '18:00', status: 'available', mode: 'PHYSICAL' }] }] } })
    render(<RescheduleModal booking={booking} onClose={() => {}} onSubmit={vi.fn()} />)
    expect(await screen.findByText(/No free times this week/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send Request' })).toBeDisabled()
  })

  test('unpaid choices leave more than one hour for payment while confirmed lessons keep nearby times', async () => {
    api.get.mockResolvedValue({ data: { days: [{ date: '2026-10-20', slots: [
      { start: '16:30', end: '17:30', status: 'available', mode: 'ONLINE' },
      { start: '17:00', end: '18:00', status: 'available', mode: 'ONLINE' },
      { start: '18:00', end: '19:00', status: 'available', mode: 'ONLINE' },
    ] }] } })
    const now = Date.parse('2026-10-20T08:00:00Z') // 16:00 in Malaysia
    const { rerender } = render(<RescheduleModal booking={{ ...booking, status: 'AWAITING_PAYMENT' }} now={now} onClose={() => {}} onSubmit={vi.fn()} />)
    expect(await screen.findByRole('button', { name: '6:00 PM' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '4:30 PM' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '5:00 PM' })).not.toBeInTheDocument()
    rerender(<RescheduleModal booking={{ ...booking, status: 'CONFIRMED' }} now={now} onClose={() => {}} onSubmit={vi.fn()} />)
    expect(await screen.findByRole('button', { name: '4:30 PM' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5:00 PM' })).toBeInTheDocument()
  })

  test('changing weeks clears the chosen time before another request can be sent', async () => {
    api.get.mockResolvedValueOnce({ data: { days } }).mockResolvedValueOnce({ data: { days: [] } })
    const onSubmit = vi.fn()
    render(<RescheduleModal booking={booking} onClose={() => {}} onSubmit={onSubmit} />)
    await userEvent.click(await screen.findByRole('button', { name: '5:00 PM' }))
    expect(screen.getByRole('button', { name: 'Send Request' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByText(/No free times this week/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send Request' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('a delayed response for a previous week cannot replace the current calendar', async () => {
    let previous, current
    api.get.mockReturnValueOnce(new Promise(resolve => { previous = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { current = resolve }))
    render(<RescheduleModal booking={booking} onClose={() => {}} onSubmit={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await act(async () => current({ data: { days: [{ date: '2026-10-27', slots: [{ start: '18:00', end: '19:00', status: 'available', mode: 'ONLINE' }] }] } }))
    expect(screen.getByRole('button', { name: '6:00 PM' })).toBeInTheDocument()
    await act(async () => previous({ data: { days } }))
    expect(screen.getByRole('button', { name: '6:00 PM' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '5:00 PM' })).not.toBeInTheDocument()
  })
})
