import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import TutorRates from '../pages/admin/TutorRates'
import Reports from '../pages/admin/Reports'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() }, errorMessage: e => e.message }))
beforeEach(() => vi.resetAllMocks())

test('a commission decision sends the displayed rate and the admin reason', async () => {
  api.get.mockResolvedValue({ data: { base: 12, tutors: [{ id: 8, name: 'Tutor A', hourly: 50, commission: 12, history: [] }] } })
  api.patch.mockResolvedValue({})
  render(<TutorRates />)
  const rate = await screen.findByLabelText('New commission (%)')
  fireEvent.change(rate, { target: { value: '10' } })
  fireEvent.change(screen.getAllByLabelText('Reason')[0], { target: { value: 'Annual review' } })
  fireEvent.submit(rate.closest('form'))
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/rates/8', { kind: 'COMMISSION', previous: 12, rate: 10, reason: 'Annual review' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Rate saved')
})

test('the report date controls request the selected period', async () => {
  api.get.mockResolvedValue({ data: { gross: 100, refunded: 0, netCollected: 100, commission: 12, bookings: 2, transactionCount: 1, months: [], statuses: {}, performance: [] } })
  render(<Reports />)
  expect(await screen.findByText('Net collected')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } })
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-30' } })
  fireEvent.click(screen.getByText('Apply dates'))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/reports?from=2026-11-01&to=2026-11-30', expect.anything()))
})

test('finance shows the attendance finding alongside an existing refund reason', async () => {
  const { default: Finance } = await import('../pages/admin/Finance')
  api.get.mockImplementation(async path => ({ data: { rows: path.startsWith('/admin/refunds?') ? [
    { id: 9, bookingId: 17, attendanceOutcome: 'NOT_HELD', parent: 'Parent', amount: 80, paid: 80, status: 'PENDING', reason: 'Parent requested review' },
  ] : [] } }))
  render(<Finance />)
  fireEvent.click(screen.getByRole('button', { name: 'Refunds' }))
  fireEvent.click(await screen.findByText(/#17/))
  expect(screen.getByText('Attendance review: Lesson did not take place')).toBeVisible()
  expect(screen.getByText(/Reason: Parent requested review/)).toBeVisible()
})

test('finance loads another refund page when requested', async () => {
  const { default: Finance } = await import('../pages/admin/Finance')
  api.get.mockImplementation(async path => ({ data: path.startsWith('/admin/refunds?') ? {
    rows: [{ id: path.includes('page=2') ? 2 : 1, bookingId: path.includes('page=2') ? 102 : 101, parent: 'Parent', amount: 20, paid: 20, status: 'PENDING', reason: 'Review' }],
    pagination: { page: path.includes('page=2') ? 2 : 1, totalPages: 2 },
  } : { rows: [] } }))
  render(<Finance />)
  fireEvent.click(screen.getByRole('button', { name: 'Refunds' }))
  expect(await screen.findByText(/#101/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText(/#102/)).toBeVisible()
  expect(screen.getByText('Page 2 of 2')).toBeVisible()
})

test('transaction pages keep search across the complete result', async () => {
  const { default: Finance } = await import('../pages/admin/Finance')
  api.get.mockResolvedValue({ data: { rows: Array.from({ length: 21 }, (_, i) => ({ id: i + 1, bookingId: i + 1, type: 'Payment', tutor: `Tutor ${i + 1}`, parent: 'Parent', status: 'PAID', date: '2026-11-01', amount: 100, commission: 10, tutorNet: 90 })) } })
  render(<Finance />)
  expect(await screen.findAllByText('Tutor 1')).not.toHaveLength(0)
  expect(screen.queryByText('Tutor 21')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect((await screen.findAllByText('Tutor 21')).length).toBeGreaterThan(0)
  fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'Tutor 1' } })
  expect((await screen.findAllByText('Tutor 1')).length).toBeGreaterThan(0)
  expect(screen.queryByText('Tutor 21')).toBeNull()
})

test('transaction search and export request the full matching server result', async () => {
  const { default: Finance } = await import('../pages/admin/Finance')
  const sample = { id: 1, bookingId: 1, type: 'Payment', tutor: 'Tutor A', parent: 'Parent', status: 'PAID', date: '2026-11-01', amount: 100, commission: 10, tutorNet: 90 }
  api.get.mockImplementation(async path => ({ data: path.includes('export=1') ? { rows: [sample, { ...sample, id: 2 }] } : { rows: [sample], pagination: { page: 1, totalPages: 1, total: 1 } } }))
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<Finance />)
  await screen.findAllByText('Tutor A')
  fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'Tutor A' } })
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('q=Tutor+A'), expect.anything()))
  await screen.findAllByText('Tutor A')
  fireEvent.click(await screen.findByRole('button', { name: 'Export CSV' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('export=1')))
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
  const csv = await URL.createObjectURL.mock.calls[0][0].text()
  expect(csv).toContain('Payment #2')
})

test.each(['PENDING', 'APPROVED'])('finance cannot act on a held %s refund', async status => {
  const { default: Finance } = await import('../pages/admin/Finance')
  api.get.mockImplementation(async path => ({ data: { rows: path.startsWith('/admin/refunds?') ? [
    { id: 9, bookingId: 17, parent: 'Parent', paid: 80, amount: 80, status, attendanceOutcome: 'MORE_INFO', attendanceRefundState: 'ON_HOLD' },
  ] : [] } }))
  render(<Finance />)
  fireEvent.click(screen.getByRole('button', { name: 'Refunds' }))
  fireEvent.click(await screen.findByText(/#17/))
  expect(screen.getByText(/Refund on hold/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /Save refund decision|Record completed transfer/ })).toBeNull()
})

test('admin sees the refund option when a cancelled lesson has an escalated new-time request', async () => {
  const { default: BookingOversight } = await import('../pages/admin/BookingOversight')
  api.get.mockResolvedValue({ data: { rows: [{ id: 8, parent: 'Parent', tutor: 'Tutor', student: 'Student', subject: 'Mathematics', startAt: '2027-01-01T00:00:00Z', status: 'CANCELLED', cancellationChoiceStatus: 'RESCHEDULING', version: 'v1', cases: [{ id: 4, kind: 'Schedule change', reason: 'New time not agreed', proposed: '2027-01-02T00:00:00Z' }] }] } })
  render(<BookingOversight />)
  fireEvent.click(await screen.findByText(/Schedule change · #8/))
  expect(screen.getByRole('option', { name: 'Decline new time and send refund for review' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Approve proposed time' })).toBeInTheDocument()
})
