import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import Earnings from '../pages/tutor/Earnings'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, errorMessage: e => e.message }))
const bank = { id: 4, bankName: 'Example Bank', accountName: 'Example Tutor', lastFour: '7890' }
const view = { available: '80.20', totalEarned: 90, pending: 12, held: 9.8, withdrawn: 0, rate: 10, baseRate: 15, version: 'initial',
  bank, bankAuth: 'password', withdrawals: [], transactions: [] }
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())
test('a withdrawal uses the displayed balance version and refreshes the hold and history', async () => {
  api.get.mockResolvedValueOnce({ data: view }).mockResolvedValue({ data: { ...view, available: '70.20', held: '19.80', withdrawals: [
    { id: 3, date: '2026-11-13', amount: '10.00', status: 'PENDING', bank },
  ] } })
  api.post.mockResolvedValue({ data: { id: 3 } })
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Request withdrawal' }))
  fireEvent.change(await screen.findByLabelText('Amount (RM)'), { target: { value: '10.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))
  expect(await screen.findByText(/RM 10.00 · In review/)).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith('/tutor/earnings/withdrawals', { amount: '10.00', bankId: 4, version: 'initial' })
  expect(screen.getByText('RM 70.20')).toBeInTheDocument()
})
test('bank details are masked and replacement asks for confirmation', async () => {
  api.get.mockResolvedValue({ data: view })
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit account' }))
  expect(screen.getByLabelText('Account number')).toHaveValue('')
  expect(screen.getByLabelText('Confirm your password')).toHaveAttribute('type', 'password')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByLabelText('Account number')).toBeNull())
  expect(api.put).not.toHaveBeenCalled()
})

test('a bank conflict refreshes the destination and requires a fresh confirmation form', async () => {
  const latest = { ...bank, id: 5, bankName: 'New Bank', lastFour: '4321' }
  api.get.mockResolvedValueOnce({ data: view }).mockResolvedValue({ data: { ...view, bank: latest } })
  api.put.mockRejectedValueOnce(Object.assign(new Error('Bank details changed. Refresh and try again.'), { response: { status: 409 } }))
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit account' }))
  fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '1234567890' } })
  fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'SyntheticPassword' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))
  expect(await screen.findByText('Review the latest bank account, then start again if you still want to change it.')).toBeInTheDocument()
  expect(screen.queryByLabelText('Confirm your password')).not.toBeInTheDocument()
  expect(api.put).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/New Bank ••4321/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Edit account' }))
  expect(screen.getByLabelText('Confirm your password')).toHaveValue('')
  expect(screen.getByLabelText('Bank', { exact: true })).toHaveValue('New Bank')
})

test('approved funds await transfer and paid history shows reference and receipt', async () => {
  api.get.mockResolvedValue({ data: { ...view, held: 88, withdrawals: [
    { id: 1, amount: 88, date: '2026-11-19', status: 'APPROVED', payoutStatus: 'AWAITING_TRANSFER', bank },
    { id: 2, amount: 50, date: '2026-11-18', status: 'APPROVED', payoutStatus: 'PAID', bank, transferRef: 'BANK123', paidAt: '2026-11-19', receiptUrl: 'https://example.test/receipt' },
  ] } })
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  expect(await screen.findByText(/RM 88.00 · Awaiting transfer/)).toBeInTheDocument()
  expect(screen.getByText(/RM 50.00 · Paid/)).toBeInTheDocument()
  expect(screen.getByText('Transfer reference: BANK123')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View transfer receipt' })).toHaveAttribute('href', 'https://example.test/receipt')
})

test('a withdrawal on hold stays in pending history and explains why', async () => {
  api.get.mockResolvedValue({ data: { ...view, held: 88, withdrawals: [
    { id: 1, amount: 88, date: '2026-11-19', status: 'APPROVED', payoutStatus: 'ON_HOLD', bank },
  ] } })
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  expect(await screen.findByText(/RM 88.00 · On hold — earnings under review/)).toBeInTheDocument()
  expect(screen.getByText('Your earnings changed. Admin will review the withdrawal.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Pending withdrawals' })).toBeInTheDocument()
})
