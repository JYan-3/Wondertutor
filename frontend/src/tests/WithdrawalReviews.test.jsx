import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import WithdrawalReviews from '../pages/admin/WithdrawalReviews'
import api from '../api/client'
import { uploadImage } from '../components/PhotoPicker'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../components/PhotoPicker', () => ({ uploadImage: vi.fn(), uploadError: e => e.message }))
const row = { id: 1, tutor: 'Iris', amount: '88', date: '2026-11-19', status: 'APPROVED', payoutStatus: 'AWAITING_TRANSFER',
  bank: { bankName: 'Test Bank', accountName: 'Iris', lastFour: '8901' } }
beforeEach(() => {
  vi.resetAllMocks()
  api.get.mockResolvedValue({ data: { requests: [row] } })
  api.post.mockResolvedValue({ data: { emailSent: true } })
})

test('admin records a reference and uploaded receipt, then sees paid history', async () => {
  const receipt = { url: 'https://example.test/receipt.pdf', version: 1, signature: 'test' }
  uploadImage.mockResolvedValue(receipt)
  render(<WithdrawalReviews />)
  const button = await screen.findByRole('button', { name: 'Record transfer as paid' })
  expect(button).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  fireEvent.change(screen.getByLabelText('Bank transfer reference'), { target: { value: 'BANK123' } })
  fireEvent.change(screen.getByLabelText('Transfer receipt'), { target: { files: [new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })] } })
  await waitFor(() => expect(button).toBeEnabled())
  expect(uploadImage).toHaveBeenCalledWith(expect.any(File), 'withdrawal-receipt', 1)
  fireEvent.click(screen.getByRole('checkbox'))
  api.get.mockResolvedValue({ data: { requests: [{ ...row, payoutStatus: 'PAID', transferRef: 'BANK123', receiptUrl: 'https://example.test/receipt.pdf' }] } })
  fireEvent.click(button)
  expect(await screen.findByText('Paid')).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith('/admin/withdrawals/1/transfer', { reference: 'BANK123', receipt })
  expect(screen.queryByRole('button', { name: 'Record transfer as paid' })).toBeNull()
  expect(screen.getByRole('link', { name: 'View transfer receipt' })).toHaveAttribute('href', 'https://example.test/receipt.pdf')
})

test('rejection requires a reason', async () => {
  api.get.mockResolvedValue({ data: { requests: [{ ...row, status: 'PENDING', payoutStatus: 'PENDING' }] } })
  render(<WithdrawalReviews />)
  fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
  expect(screen.getByRole('button', { name: 'Confirm decision' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Reason for rejection'), { target: { value: 'Please check account ownership' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/withdrawals/1/review', { status: 'REJECTED', expectedStatus: 'PENDING', reason: 'Please check account ownership' }))
})

test('a duplicate transfer response is displayed and does not resubmit', async () => {
  uploadImage.mockResolvedValue({ url: 'https://example.test/receipt.pdf', version: 1, signature: 'test' })
  api.post.mockRejectedValue(new Error('This withdrawal has already been paid.'))
  render(<WithdrawalReviews />)
  fireEvent.change(await screen.findByLabelText('Bank transfer reference'), { target: { value: 'BANK123' } })
  fireEvent.change(screen.getByLabelText('Transfer receipt'), { target: { files: [new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })] } })
  const button = await screen.findByRole('button', { name: 'Record transfer as paid' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(button)
  expect(await screen.findByText('This withdrawal has already been paid.')).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

test('approval changes to awaiting transfer and reports an email failure clearly', async () => {
  api.get.mockResolvedValueOnce({ data: { requests: [{ ...row, status: 'PENDING', payoutStatus: 'PENDING' }] } })
    .mockResolvedValue({ data: { requests: [row] } })
  api.post.mockResolvedValue({ data: { emailSent: false } })
  render(<WithdrawalReviews />)
  fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }))
  expect(await screen.findByText('Awaiting transfer')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('email could not be delivered')
  expect(api.post).toHaveBeenCalledWith('/admin/withdrawals/1/review', { status: 'APPROVED', expectedStatus: 'PENDING' })
})
