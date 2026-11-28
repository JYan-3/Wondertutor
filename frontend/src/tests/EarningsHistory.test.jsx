import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import Earnings from '../pages/tutor/Earnings'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, errorMessage: (e) => e.message }))

const bank = { id: 4, bankName: 'Example Bank', accountName: 'Example Tutor', lastFour: '7890' }
const view = { available: '45.00', totalEarned: 90, pending: 0, held: 0, withdrawn: 45, rate: 12, baseRate: 15, version: 'v1',
  bank, bankAuth: 'password', withdrawals: [], transactions: [] }
const row = (id, date, extra = {}) => ({ id, bookingId: 100 + id, date, subject: 'Mathematics', student: 'Sarah', fee: '100.00', commission: '12.00',
  originalCommission: '12.00', refunded: '0', rate: '12', net: '88.00', state: 'Earned', ...extra })
const show = (data = view) => {
  api.get.mockResolvedValue({ data })
  return render(<MemoryRouter><Earnings /></MemoryRouter>)
}

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

test('shows available, held and transferred amounts with saved-rate guidance', async () => {
  show()
  expect(await screen.findByText('Available to withdraw')).toBeInTheDocument()
  expect(screen.getByText(/Total earned: RM 90.00/)).toBeInTheDocument()
  expect(screen.getByText(/current commission rate: 12%/)).toBeInTheDocument()
  expect(screen.getByText(/platform base: 15%/)).toBeInTheDocument()
  expect(screen.getByText('Total paid: RM 45.00')).toBeInTheDocument()
})

test('a new tutor sees empty states and cannot request a withdrawal without a bank', async () => {
  show({ ...view, available: '0.00', bank: null })
  expect(await screen.findAllByText('Add a bank account to request a withdrawal.')).toHaveLength(2)
  expect(screen.getByText('No lesson payments for this period.')).toBeInTheDocument()
  expect(screen.getByText('No withdrawals yet.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Request withdrawal' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Add bank account' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove account' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
})

test('the withdraw button stays off until an amount is typed', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Request withdrawal' }))
  const button = screen.getByRole('button', { name: 'Confirm withdrawal' })
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Amount (RM)'), { target: { value: '5' } })
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Amount (RM)'), { target: { value: '10' } })
  expect(button).toBeEnabled()
  expect(screen.getByLabelText('Amount (RM)')).toHaveAttribute('max', '45')
})

test('a refused withdrawal shows the reason and reloads the balance', async () => {
  show()
  api.post.mockRejectedValue(new Error('Your balance changed. Refresh and check your withdrawal history.'))
  fireEvent.click(await screen.findByRole('button', { name: 'Request withdrawal' }))
  fireEvent.change(await screen.findByLabelText('Amount (RM)'), { target: { value: '10' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))
  expect(await screen.findByText(/Your balance changed/)).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledTimes(2)
})

test('a lesson with a refund shows the refund and the original commission', async () => {
  show({ ...view, transactions: [row(1, new Date().toISOString(), { refunded: '33.33', originalShare: 88, tutorRefundShare: 29.33, platformRefundShare: 4, commission: '8.00', net: '58.67' })] })
  const item = (await screen.findByText('Mathematics · Sarah')).closest('li')
  expect(within(item).getByText('Refund to parent')).toBeInTheDocument()
  expect(within(item).getByText('RM 33.33', { selector: 'dd' })).toBeInTheDocument()
  expect(within(item).getByText('RM 29.33')).toBeInTheDocument()
  expect(within(item).getByText('RM 58.67', { selector: 'dd' })).toBeInTheDocument()
  expect(within(item).getByText(/Booking #101/)).toBeInTheDocument()
})

test('a lesson without a refund hides the refund lines', async () => {
  show({ ...view, transactions: [row(1, new Date().toISOString())] })
  const item = (await screen.findByText('Mathematics · Sarah')).closest('li')
  expect(within(item).queryByText('Refund to parent')).toBeNull()
  expect(within(item).getByText('Saved commission (12%)')).toBeInTheDocument()
})

test('lesson summaries expand and filter without changing the earned amounts', async () => {
  show({ ...view, transactions: [row(1, new Date().toISOString()), row(2, new Date().toISOString(), { student: 'Ben', state: 'Report due', net: '30.00' })] })
  const item = (await screen.findByText('Mathematics · Sarah')).closest('li')
  expect(within(item).getByText('RM 88.00', { selector: 'strong' })).toBeVisible()
  expect(item.querySelector('details')).not.toHaveAttribute('open')
  fireEvent.click(within(item).getByText('Mathematics · Sarah'))
  expect(item.querySelector('details')).toHaveAttribute('open')
  expect(within(item).getByText('Commission (12%)')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Lesson status'), { target: { value: 'Report due' } })
  expect(screen.queryByText('Mathematics · Sarah')).not.toBeInTheDocument()
  expect(screen.getByText('Mathematics · Ben')).toBeVisible()
})

test('paginates ten lessons and returns to the first page when a filter changes', async () => {
  show({ ...view, transactions: Array.from({ length: 12 }, (_, i) => row(i + 1, new Date().toISOString(), { student: `Student ${i + 1}`, state: i === 11 ? 'Report due' : 'Earned' })) })
  expect(await screen.findByText(/Showing 1–10 of 12 lessons/)).toBeVisible()
  expect(screen.queryByText('Mathematics · Student 11')).not.toBeInTheDocument()
  const pages = within(screen.getByRole('navigation', { name: 'Lesson history pages' }))
  expect(pages.getByRole('button', { name: 'Previous' })).toBeDisabled()
  fireEvent.click(pages.getByRole('button', { name: 'Next' }))
  expect(screen.getByText('Mathematics · Student 11')).toBeVisible()
  expect(screen.getByText(/Showing 11–12 of 12 lessons/)).toBeVisible()
  expect(pages.getByRole('button', { name: 'Next' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Lesson status'), { target: { value: 'Earned' } })
  expect(screen.getByText(/Showing 1–10 of 11 lessons/)).toBeVisible()
  expect(screen.getByText('Page 1 of 2')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.change(screen.getByLabelText('Transaction period'), { target: { value: 'month' } })
  expect(screen.getByText('Page 1 of 2')).toBeVisible()
})

test('loads filtered history pages and exports all matching lessons from the server', async () => {
  const transactions = Array.from({ length: 12 }, (_, i) => row(i + 1, new Date().toISOString(), { student: `Student ${i + 1}` }))
  const { transactions: ignored, ...compact } = view
  expect(ignored).toEqual([])
  api.get.mockImplementation(async (path, options) => {
    if (path !== '/tutor/earnings/history') return { data: compact }
    const params = options.params
    return { data: { rows: params.export ? transactions : transactions.slice((params.page - 1) * 10, params.page * 10), states: ['Earned'], pagination: { page: params.page, totalPages: 2, total: 12 } } }
  })
  const create = vi.fn(() => 'blob:x')
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  expect(await screen.findByText('Mathematics · Student 1')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('Mathematics · Student 11')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Lesson status'), { target: { value: 'Earned' } })
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/tutor/earnings/history', expect.objectContaining({ params: expect.objectContaining({ page: 1, state: 'Earned' }) })))
  expect(await screen.findByText('Mathematics · Student 1')).toBeVisible()
  fireEvent.click(await screen.findByRole('button', { name: 'Export CSV' }))
  await waitFor(() => expect(create).toHaveBeenCalled())
  expect(await create.mock.calls[0][0].text()).toContain('Student 12')
})

test('saves a selected bank or a bank entered through Other bank', async () => {
  show({ ...view, bank: null })
  api.put.mockResolvedValue({ data: {} })
  fireEvent.click(await screen.findByRole('button', { name: 'Add bank account' }))
  fireEvent.change(screen.getByLabelText('Bank', { exact: true }), { target: { value: 'Maybank' } })
  fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: 'Tutor Name' } })
  fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '1234567890' } })
  fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/tutor/earnings/bank', expect.objectContaining({ details: { bankName: 'Maybank', accountName: 'Tutor Name', accountNumber: '1234567890' } })))
  fireEvent.click(await screen.findByRole('button', { name: 'Add bank account' }))
  fireEvent.change(screen.getByLabelText('Bank', { exact: true }), { target: { value: '__other__' } })
  fireEvent.change(screen.getByLabelText('Other bank name'), { target: { value: 'Another Bank' } })
  fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: 'Tutor Name' } })
  fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '1234567890' } })
  fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))
  await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/tutor/earnings/bank', expect.objectContaining({ details: { bankName: 'Another Bank', accountName: 'Tutor Name', accountNumber: '1234567890' } })))
})

test('This month hides payments from earlier months', async () => {
  show({ ...view, transactions: [row(1, new Date().toISOString(), { student: 'Now' }), row(2, '2020-01-15T04:00:00.000Z', { student: 'Old' })] })
  await screen.findByText('Mathematics · Old')
  fireEvent.change(screen.getByLabelText('Transaction period'), { target: { value: 'month' } })
  expect(screen.getByText('Mathematics · Now')).toBeInTheDocument()
  expect(screen.queryByText('Mathematics · Old')).toBeNull()
})

test('Export CSV downloads all filtered payments across pages', async () => {
  const create = vi.fn(() => 'blob:x')
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  show({ ...view, transactions: [...Array.from({ length: 12 }, (_, i) => row(i + 1, new Date().toISOString(), { student: `Student ${i + 1}` })), row(13, new Date().toISOString(), { student: 'Excluded', state: 'Report due' })] })
  await screen.findByText('Mathematics · Student 1')
  fireEvent.change(screen.getByLabelText('Lesson status'), { target: { value: 'Earned' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Export CSV' }))
  expect(click).toHaveBeenCalled()
  const text = await create.mock.calls[0][0].text()
  expect(text).toContain('"Date","Booking","Student"')
  expect(text).toContain('"Student 12","Mathematics","100.00"')
  expect(text).not.toContain('Excluded')
})

test('withdrawal history shows each status and the rejection reason', async () => {
  show({ ...view, withdrawals: [
    { id: 1, date: '2026-11-01T02:00:00.000Z', amount: '20', status: 'REJECTED', reason: 'Name does not match', bank },
    { id: 2, date: '2026-11-02T02:00:00.000Z', amount: '10', status: 'APPROVED', payoutStatus: 'PAID', bank },
    { id: 3, date: '2026-11-03T02:00:00.000Z', amount: '5', status: 'ESCALATED', bank },
  ] })
  expect(await screen.findByText('RM 20.00 · Rejected')).toBeInTheDocument()
  expect(screen.getByText('Reason: Name does not match')).toBeInTheDocument()
  expect(screen.getByText('RM 10.00 · Paid')).toBeInTheDocument()
  const pending = within(screen.getByRole('heading', { name: 'Pending withdrawals' }).parentElement)
  expect(pending.getByText(/Bank change under review/)).toBeInTheDocument()
  expect(pending.queryByText(/Paid/)).toBeNull()
  const history = within(screen.getByRole('heading', { name: 'Withdrawal history' }).closest('section'))
  expect(history.getByText(/Bank change under review/)).toBeInTheDocument()
})

test('removing the bank account sends no details and confirms', async () => {
  show()
  api.put.mockResolvedValue({ data: { message: 'Bank details saved.' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Remove account' }))
  expect(screen.queryByLabelText('Account number')).toBeNull()
  fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'SyntheticPassword' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))
  expect(await screen.findByText('Bank account removed.')).toBeInTheDocument()
  expect(api.put).toHaveBeenCalledWith('/tutor/earnings/bank', { currentBankId: 4, details: null, confirmation: 'SyntheticPassword' })
})

test('a wrong password keeps the form open with the error', async () => {
  show()
  api.put.mockRejectedValue(Object.assign(new Error('Incorrect password.'), { response: { status: 403 } }))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit account' }))
  fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '1234567890' } })
  fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'wrong' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))
  expect(await screen.findByText('Incorrect password.')).toBeInTheDocument()
  expect(screen.getByLabelText('Account number')).toBeInTheDocument()
})

test('a Google sign-in tutor asks for an email code instead of a password', async () => {
  show({ ...view, bankAuth: 'code' })
  api.post.mockResolvedValue({ data: { message: 'Check your email for the code.' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Edit account' }))
  expect(screen.queryByLabelText('Confirm your password')).toBeNull()
  expect(screen.getByLabelText('Email code')).toHaveAttribute('type', 'text')
  fireEvent.click(screen.getByRole('button', { name: 'Email confirmation code' }))
  expect(await screen.findByText('Check your email for the confirmation code.')).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith('/tutor/earnings/bank-code')
})

test('a failed page load can be retried', async () => {
  api.get.mockRejectedValueOnce(new Error('Network error')).mockResolvedValue({ data: view })
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  expect(await screen.findByText('Network error')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
  await waitFor(() => expect(screen.getByText('Available to withdraw')).toBeInTheDocument())
})
