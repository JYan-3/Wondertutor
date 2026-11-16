import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import Payments from '../pages/parent/Payments'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../components/LessonDetails', () => ({ default: () => null }))
const booking = { id: 1, publicId: 'booking-public-id', subject: 'Mathematics', startAt: '2026-12-21T09:00:00Z', endAt: '2026-12-21T10:00:00Z', totalAmount: 60,
  teachingMode: 'ONLINE', tutor: { name: 'Test Tutor' }, child: { name: 'Test Child', educationLevel: 'PRIMARY', grade: 5 } }
function renderPayments(gateway = 'toyyibpay', b = booking) {
  api.get.mockResolvedValue({ data: { gateway, required: [b], summary: { totalPaid: 0, pendingPayment: 60, paidThisMonth: 0 }, transactions: [], banks: ['Maybank2u'] } })
  render(<MemoryRouter><Payments /></MemoryRouter>)
}
beforeEach(() => vi.clearAllMocks())

test('ToyyibPay checkout shows the real provider and does not offer simulated payment controls', async () => {
  renderPayments()
  await userEvent.click(await screen.findByRole('button', { name: /Pay Now/ }))
  expect(screen.getByRole('button', { name: 'Pay RM 60.00 with ToyyibPay' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Simulate failed/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Change Payment Method/ })).not.toBeInTheDocument()
})
test('checkout failures retain the modal and give an actionable error instead of navigating', async () => {
  api.post.mockRejectedValue(new Error('Please add a valid phone number in My Profile before paying.'))
  renderPayments()
  await userEvent.click(await screen.findByRole('button', { name: /Pay Now/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Pay RM 60.00 with ToyyibPay' }))
  expect(api.post).toHaveBeenCalledWith('/parent/payments/checkout', { bookingId: booking.publicId })
  expect(await screen.findByText(/valid phone number in My Profile/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pay RM 60.00 with ToyyibPay' })).toBeEnabled()
})
test('reconciled checkout reloads payments rather than opening an undefined URL', async () => {
  api.post.mockResolvedValue({ data: { reconciled: true } })
  renderPayments()
  await userEvent.click(await screen.findByRole('button', { name: /Pay Now/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Pay RM 60.00 with ToyyibPay' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
test('unconfigured production payments cannot open the development simulator', async () => {
  renderPayments('unavailable')
  expect(await screen.findByText(/Online payments are not available yet/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Pay Now/ })).toBeDisabled()
  expect(screen.queryByRole('button', { name: /Change Payment Method/ })).not.toBeInTheDocument()
})
test('an existing Billplz payment keeps its original provider label during transition', async () => {
  renderPayments('toyyibpay', { ...booking, payment: { method: 'Billplz' } })
  await userEvent.click(await screen.findByRole('button', { name: /Pay Now/ }))
  expect(screen.getByRole('button', { name: 'Pay RM 60.00 with Billplz' })).toBeInTheDocument()
})
