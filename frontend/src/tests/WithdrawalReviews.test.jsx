import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import WithdrawalReviews from '../pages/admin/WithdrawalReviews'
import api from '../api/client'
import { uploadImage } from '../components/PhotoPicker'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../components/PhotoPicker', () => ({ uploadImage: vi.fn(), uploadError: e => e.message }))
const row = { id: 1, tutor: 'Iris', amount: '88', date: '2026-11-19', status: 'APPROVED', payoutStatus: 'TRANSFER_IN_PROGRESS', transferOwned: true,
  bank: { bankName: 'Test Bank', accountName: 'Iris', lastFour: '8901' } }
beforeEach(() => {
  vi.resetAllMocks()
  api.get.mockResolvedValue({ data: { requests: [row] } })
  api.post.mockResolvedValue({ data: { emailSent: true } })
})

test('admin can move between withdrawal pages', async () => {
  api.get.mockImplementation(async (_path, options) => ({ data: { requests: [{ ...row, tutor: options.params.page === 1 ? 'Iris' : 'Alya' }], pagination: { page: options.params.page, totalPages: 2 } } }))
  render(<WithdrawalReviews />)
  expect(await screen.findByText(/Iris ·/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText(/Alya ·/)).toBeVisible()
  expect(screen.getByText('Page 2 of 2')).toBeVisible()
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
    .mockResolvedValue({ data: { requests: [{ ...row, payoutStatus: 'AWAITING_TRANSFER' }] } })
  api.post.mockResolvedValue({ data: { emailSent: false } })
  render(<WithdrawalReviews />)
  fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }))
  expect(await screen.findByText('Awaiting transfer')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('email could not be delivered')
  expect(api.post).toHaveBeenCalledWith('/admin/withdrawals/1/review', { status: 'APPROVED', expectedStatus: 'PENDING' })
})

test('a held withdrawal explains the problem and does not offer a transfer', async () => {
  api.get.mockResolvedValue({ data: { requests: [{ ...row, payoutStatus: 'ON_HOLD', earned: 0, held: 88, paidOut: 0, balance: -88 }] } })
  render(<WithdrawalReviews />)
  expect(await screen.findByText('On hold — earnings changed')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm earnings review' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Start transfer' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Show bank details for transfer' })).toBeNull()
})

test('admin can reject a held request with a reason', async () => {
  api.get.mockResolvedValue({ data: { requests: [{ ...row, payoutStatus: 'ON_HOLD', earned: 0, held: 88, paidOut: 0, balance: -88 }] } })
  render(<WithdrawalReviews />)
  fireEvent.click(await screen.findByRole('button', { name: 'Reject held request' }))
  fireEvent.change(screen.getByLabelText('Reason for rejection'), { target: { value: 'Earnings are under refund review.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/withdrawals/1/reject-held', { reason: 'Earnings are under refund review.' }))
})

test('only the admin handling the transfer can see the recording form', async () => {
  api.get.mockResolvedValue({ data: { requests: [{ ...row, transferOwned: false }] } })
  render(<WithdrawalReviews />)
  expect(await screen.findByText('Another admin is handling this transfer. Do not send money.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Record transfer as paid' })).toBeNull()
})

test('admin can start a transfer and release it after checking the bank', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  api.get.mockResolvedValueOnce({ data: { requests: [{ ...row, payoutStatus: 'AWAITING_TRANSFER' }] } })
    .mockResolvedValueOnce({ data: { requests: [row] } })
    .mockResolvedValue({ data: { requests: [{ ...row, payoutStatus: 'AWAITING_TRANSFER' }] } })
  render(<WithdrawalReviews />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start transfer' }))
  expect(await screen.findByRole('button', { name: 'Release transfer' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Release transfer' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/withdrawals/1/release-transfer', { confirmedNoTransfer: true }))
  expect(api.post).toHaveBeenCalledWith('/admin/withdrawals/1/start-transfer', {})
  confirm.mockRestore()
})

test('a transfer already sent can be recorded after an earnings change with an extra confirmation', async () => {
  api.get.mockResolvedValue({ data: { requests: [{ ...row, payoutStatus: 'TRANSFER_REVIEW', earned: 0, held: 88, paidOut: 0, balance: -88 }] } })
  uploadImage.mockResolvedValue({ url: 'https://example.test/receipt.pdf', version: 1, signature: 'test' })
  render(<WithdrawalReviews />)
  expect(await screen.findByText(/Do not start a transfer/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Bank transfer reference'), { target: { value: 'BANK123' } })
  fireEvent.change(screen.getByLabelText('Transfer receipt'), { target: { files: [new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })] } })
  const button = await screen.findByRole('button', { name: 'Record transfer as paid' })
  expect(button).toBeDisabled()
  fireEvent.click(screen.getByLabelText(/I checked the bank and confirm/))
  fireEvent.click(screen.getByLabelText(/I confirm the bank transfer succeeded/))
  fireEvent.click(button)
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/withdrawals/1/transfer', expect.objectContaining({ balanceChangedConfirmed: true })))
})
