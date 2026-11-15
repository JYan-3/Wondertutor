import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import AdminComplaints from '../pages/admin/AdminComplaints'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../components/ComplaintsReport', () => ({ default: () => null }))
const response = (page = 1, status = 'OPEN', text = 'Complaint page ' + page) => ({ data: {
  counts: { OPEN: 25, RESOLVED: 4, IN_PROGRESS: 0, DISMISSED: 0 },
  complaints: [{ id: page, status, category: 'Other', description: text, createdAt: '2026-11-01', filedBy: { name: 'Parent', email: 'parent@test.local' } }],
  pagination: { page, pageSize: 20, total: 25, totalPages: 2 },
} })
function Location() { return <output aria-label="Current address">{useLocation().search}</output> }
const open = (url = '/admin/complaints?status=OPEN') => render(<MemoryRouter initialEntries={[url]}><Location /><AdminComplaints /></MemoryRouter>)
beforeEach(() => vi.resetAllMocks())

test('Next, Previous and status changes retain the correct URL filters', async () => {
  api.get.mockImplementation(async (_path, { params }) => response(Number(params.page), params.status || 'OPEN'))
  open()
  await screen.findByText('Complaint page 1')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Complaint page 2')
  expect(screen.getByLabelText('Current address')).toHaveTextContent('status=OPEN&page=2')
  expect(api.get).toHaveBeenLastCalledWith('/admin/complaints', { params: { status: 'OPEN', page: '2', pageSize: 20 } })
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  await screen.findByText('Complaint page 1')
  fireEvent.click(screen.getByRole('button', { name: /^Resolved/ }))
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/admin/complaints', { params: { status: 'RESOLVED', page: '1', pageSize: 20 } }))
  expect(screen.getByLabelText('Current address')).toHaveTextContent('status=RESOLVED')
})

test('a slow previous filter result cannot overwrite the current queue', async () => {
  let old
  api.get.mockImplementation((_path, { params }) => params.status === 'OPEN' ? new Promise(resolve => { old = resolve }) : Promise.resolve(response(1, 'RESOLVED', 'Current resolved complaint')))
  open()
  fireEvent.click(screen.getByRole('button', { name: /^Resolved/ }))
  await screen.findByText('Current resolved complaint')
  await act(async () => old(response(1, 'OPEN', 'Outdated open complaint')))
  expect(screen.queryByText('Outdated open complaint')).not.toBeInTheDocument()
  expect(screen.getByText('Current resolved complaint')).toBeInTheDocument()
})

test('a failed page hides the stale queue and retries the same page and status', async () => {
  api.get.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce(response(2))
  open()
  await screen.findByText('Complaint page 1')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Connection interrupted')
  expect(screen.queryByText('Complaint page 1')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('Complaint page 2')
  expect(api.get).toHaveBeenLastCalledWith('/admin/complaints', { params: { status: 'OPEN', page: '2', pageSize: 20 } })
})

test('late investigation evidence cannot appear inside a different complaint', async () => {
  let first
  const row = id => ({ ...response().data.complaints[0], id, category: 'Missed check-in' })
  api.get.mockImplementation(path => {
    if (path === '/admin/complaints') return Promise.resolve({ data: { counts: { OPEN: 2 }, complaints: [row(1), row(2)] } })
    if (path.endsWith('/1')) return new Promise(resolve => { first = resolve })
    return Promise.resolve({ data: { investigation: { attendanceReview: { proof: 'https://example.org/current', parentAnswer: 'YES' }, otherComplaints: [], warnings: [] } } })
  })
  open()
  fireEvent.click((await screen.findAllByRole('button', { name: 'Review' }))[0])
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[1])
  expect(await screen.findByRole('link', { name: 'View tutor proof' })).toHaveAttribute('href', 'https://example.org/current')
  await act(async () => first({ data: { investigation: { attendanceReview: { proof: 'https://example.org/outdated' }, otherComplaints: [], warnings: [] } } }))
  expect(screen.getByRole('link', { name: 'View tutor proof' })).toHaveAttribute('href', 'https://example.org/current')
})
