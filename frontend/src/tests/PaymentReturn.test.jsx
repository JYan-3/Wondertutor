import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import PaymentReturn from '../pages/parent/PaymentReturn'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { post: vi.fn() }, errorMessage: (e) => e.message }))
beforeEach(() => vi.clearAllMocks())

test.each(['REFUNDED', 'PARTIALLY_REFUNDED'])('an old %s bill shows a refund record rather than a failed payment', async (outcome) => {
  api.post.mockResolvedValue({ data: { outcome, message: 'This payment is recorded as refunded in WonderTutor.' } })
  render(<MemoryRouter initialEntries={['/parent/payments/return?billplz[id]=old-bill&billplz[x_signature]=signed']}><PaymentReturn /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Refund recorded' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Payment not completed' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Go to Payments' })).toBeInTheDocument()
})

test('a received payment for a cancelled lesson does not show booking confirmed', async () => {
  api.post.mockResolvedValue({ data: { outcome: 'RECORDED', message: 'Payment was received, but the booking is no longer confirmed.' } })
  render(<MemoryRouter initialEntries={['/parent/payments/return?billplz[id]=old-bill&billplz[x_signature]=signed']}><PaymentReturn /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Payment recorded' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Payment successful' })).not.toBeInTheDocument()
})


test('ToyyibPay browser status is ignored until our server verifies the transaction', async () => {
  api.post.mockResolvedValue({ data: { outcome: 'WAITING', message: 'The bank result is still pending.' } })
  render(<MemoryRouter initialEntries={['/parent/payments/return?billcode=toy1&order_id=WT-payment&status_id=1']}><PaymentReturn /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Payment pending' })).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith('/parent/payments/return', { gateway: 'toyyibpay', billcode: 'toy1', order_id: 'WT-payment' })
  expect(screen.queryByRole('heading', { name: 'Payment successful' })).not.toBeInTheDocument()
})

test('a pending result can be checked again without another checkout', async () => {
  api.post.mockResolvedValueOnce({ data: { outcome: 'WAITING', message: 'Pending.' } })
    .mockResolvedValueOnce({ data: { outcome: 'SUCCESS', message: 'Your lesson is confirmed.' } })
  render(<MemoryRouter initialEntries={['/parent/payments/return?billcode=toy1&order_id=WT-payment']}><PaymentReturn /></MemoryRouter>)
  await userEvent.click(await screen.findByRole('button', { name: 'Check payment again' }))
  expect(await screen.findByRole('heading', { name: 'Payment successful' })).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(2)
  expect(api.post.mock.calls.every(([url]) => url === '/parent/payments/return')).toBe(true)
})

test('network verification errors do not claim that the bank payment failed and can be retried', async () => {
  api.post.mockRejectedValueOnce(new Error('The payment service is temporarily unavailable.'))
    .mockResolvedValueOnce({ data: { outcome: 'SUCCESS', message: 'Your lesson is confirmed.' } })
  render(<MemoryRouter initialEntries={['/parent/payments/return?billcode=toy1&order_id=WT-payment']}><PaymentReturn /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Payment verification unavailable' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Payment not completed' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Check payment again' }))
  expect(await screen.findByRole('heading', { name: 'Payment successful' })).toBeInTheDocument()
})

test('missing payment references never call the verification endpoint', async () => {
  render(<MemoryRouter initialEntries={['/parent/payments/return?status_id=1']}><PaymentReturn /></MemoryRouter>)
  expect(await screen.findByText(/meant to be opened by the payment service/)).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})
