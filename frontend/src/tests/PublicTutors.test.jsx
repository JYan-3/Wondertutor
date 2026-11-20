import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'

let auth = { user: null }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: () => 'Tutors could not be loaded.' }))
import api from '../api/client'
import PublicTutors from '../pages/PublicTutors'

const tutor = { id: 7, name: 'Daniel Tan', photoUrl: null, verified: true, rating: 4.9, reviewCount: 10, hourlyRate: 60, mainSubject: 'Mathematics', levels: 'Primary 1–6', location: 'Kepong, Kuala Lumpur', offersOnline: true, offersPhysical: true }
const catalog = { subjects: ['Mathematics', 'Chemistry', 'English'], subjectLevels: { Mathematics: ['PRIMARY', 'SECONDARY'], Chemistry: ['SECONDARY'], English: ['PRIMARY', 'SECONDARY'] }, locations: ['Kepong, Kuala Lumpur'] }
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname + location.search}{JSON.stringify(location.state)}</output> }
function setup(initial = '/tutors') {
  return render(<MemoryRouter initialEntries={[initial]}><Location /><Routes><Route path="/tutors" element={<PublicTutors />} /><Route path="/login" element={<div>LOG IN</div>} /><Route path="/tutors/:id" element={<div>PUBLIC PROFILE</div>} /></Routes></MemoryRouter>)
}
beforeEach(() => {
  auth = { user: null }
  vi.clearAllMocks()
  api.get.mockImplementation(async (url, options) => url === '/public/home'
    ? { data: catalog }
    : { data: { tutors: [tutor], total: 20, totalPages: 3, page: options.params.page, pageSize: 9 } })
})

test('guests see a distinct online alternative group and keep Online through the login handoff', async () => {
  api.get.mockImplementation(async url => url === '/public/home' ? { data: catalog } : { data: {
    total: 0, tutors: [], page: 1, totalPages: 1,
    searchScope: { mode: 'PHYSICAL', location: 'Kuala Terengganu, Terengganu', radiusKm: 30 },
    onlineAlternatives: { total: 1, tutors: [{ ...tutor, searchMode: 'ONLINE' }], page: 1, totalPages: 1 },
  } })
  const user = userEvent.setup()
  setup('/tutors?subject=English&level=PRIMARY&location=Kuala%20Terengganu%2C%20Terengganu')
  expect(await screen.findByText('No nearby tutors found')).toBeVisible()
  expect(screen.getByRole('region', { name: 'Online alternatives' })).toBeVisible()
  expect(screen.getByText('Based in Kepong, Kuala Lumpur')).toBeVisible()
  expect(screen.getByRole('link', { name: 'View Profile' })).toHaveAttribute('href', '/tutors/7?mode=ONLINE')
  await user.click(screen.getByRole('link', { name: 'Book a Lesson' }))
  expect(screen.getByTestId('location')).toHaveTextContent('/parent/tutors/7/book?mode=ONLINE')
})

test('guests browse and open profiles without requesting private parent data', async () => {
  setup()
  expect(await screen.findByRole('heading', { name: 'Daniel Tan' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'View Profile' })).toHaveAttribute('href', '/tutors/7')
  expect(api.get.mock.calls.every(([url]) => url.startsWith('/public/'))).toBe(true)
  await userEvent.click(screen.getByRole('link', { name: 'View Profile' }))
  expect(screen.getByText('PUBLIC PROFILE')).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent('"fromSearch":"/tutors"')
})

test('booking asks a guest to log in and carries the selected tutor forward', async () => {
  setup()
  await screen.findByRole('heading', { name: 'Daniel Tan' })
  await userEvent.click(screen.getByRole('link', { name: 'Book a Lesson' }))
  expect(screen.getByText('LOG IN')).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent('"from":"/parent/tutors/7/book"')
})

test('changing levels clears an incompatible subject and Clear filters resets the search', async () => {
  setup()
  await screen.findByRole('heading', { name: 'Daniel Tan' })
  await userEvent.selectOptions(screen.getByLabelText('Education level'), 'SECONDARY')
  await userEvent.selectOptions(screen.getByLabelText('Subject'), 'Chemistry')
  await userEvent.selectOptions(screen.getByLabelText('Education level'), 'PRIMARY')
  expect(screen.getByLabelText('Subject')).toHaveValue('')
  expect(screen.queryByRole('option', { name: 'Chemistry' })).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Subject'), 'English')
  await userEvent.selectOptions(screen.getByLabelText('Teaching mode'), 'ONLINE')
  await userEvent.selectOptions(screen.getByLabelText('Location'), 'Kepong, Kuala Lumpur')
  await userEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/public/tutors', { params: expect.objectContaining({ subject: 'English', level: 'PRIMARY', mode: 'ONLINE', location: 'Kepong, Kuala Lumpur', page: 1 }) }))
  await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.getByLabelText('Subject')).toHaveValue('')
  expect(screen.getByLabelText('Education level')).toHaveValue('')
  expect(screen.getByLabelText('Location')).toHaveValue('')
  expect(screen.getByLabelText('Teaching mode')).toHaveValue('')
  expect(screen.getByLabelText('Sort by')).toHaveValue('recommended')
})

test('pagination preserves the current search and sort in the URL and API request', async () => {
  setup('/tutors?name=Dan&subject=Mathematics&level=PRIMARY&mode=ONLINE&sort=price_asc')
  await screen.findByRole('heading', { name: 'Daniel Tan' })
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/public/tutors', { params: expect.objectContaining({ name: 'Dan', subject: 'Mathematics', level: 'PRIMARY', mode: 'ONLINE', sort: 'price_asc', page: 2 }) }))
  expect(screen.getByTestId('location')).toHaveTextContent('page=2')
  expect(screen.getByTestId('location')).toHaveTextContent('name=Dan')
  expect(screen.getByRole('searchbox', { name: 'Tutor name' })).toHaveValue('Dan')
  expect(screen.getByLabelText('Subject')).toHaveValue('Mathematics')
  expect(screen.getByLabelText('Sort by')).toHaveValue('price_asc')
  expect(screen.getByRole('button', { name: 'Filters, 4 applied' })).toHaveTextContent('(4)')
})

test('name search trims the submitted name, keeps the other filters and restarts paging', async () => {
  const user = userEvent.setup()
  setup('/tutors?mode=ONLINE&page=2')
  await screen.findByRole('heading', { name: 'Daniel Tan' })
  const name = screen.getByRole('searchbox', { name: 'Tutor name' })
  await user.type(name, '  Dan Tan  ')
  expect(api.get.mock.calls.filter(([url]) => url === '/public/tutors')).toHaveLength(1)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/public/tutors', { params: expect.objectContaining({ name: 'Dan Tan', mode: 'ONLINE', page: 1 }) }))
  expect(screen.getByTestId('location')).toHaveTextContent('name=Dan+Tan')
  expect(screen.getByTestId('location')).not.toHaveTextContent('page=2')
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.getByRole('searchbox', { name: 'Tutor name' })).toHaveValue('')
  expect(api.get).toHaveBeenLastCalledWith('/public/tutors', { params: { sort: 'recommended', page: 1, pageSize: 9 } })
})

test('the mobile Filters disclosure preserves drafts and closes after applying them', async () => {
  const user = userEvent.setup()
  setup('/tutors?name=Dan')
  await screen.findByRole('heading', { name: 'Daniel Tan' })
  const filters = screen.getByRole('button', { name: 'Filters' })
  expect(filters).toHaveAttribute('aria-expanded', 'false')
  const panel = document.getElementById(filters.getAttribute('aria-controls'))
  expect(panel).toContainElement(screen.getByLabelText('Teaching mode'))
  await user.click(filters)
  expect(filters).toHaveAttribute('aria-expanded', 'true')
  await user.selectOptions(screen.getByLabelText('Teaching mode'), 'ONLINE')
  await user.click(filters)
  expect(filters).toHaveAccessibleName('Filters')
  await user.click(filters)
  expect(screen.getByLabelText('Teaching mode')).toHaveValue('ONLINE')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  const applied = screen.getByRole('button', { name: 'Filters, 1 applied' })
  expect(applied).toHaveAttribute('aria-expanded', 'false')
  expect(applied).toHaveTextContent('(1)')
  expect(api.get).toHaveBeenLastCalledWith('/public/tutors', { params: expect.objectContaining({ mode: 'ONLINE' }) })
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.getByRole('button', { name: 'Filters' })).not.toHaveTextContent('(1)')
})

test('Clear filters also discards unsubmitted edits when the URL already has no filters', async () => {
  setup()
  await screen.findByRole('heading', { name: 'Daniel Tan' })
  await userEvent.selectOptions(screen.getByLabelText('Education level'), 'PRIMARY')
  await userEvent.selectOptions(screen.getByLabelText('Subject'), 'English')
  await userEvent.selectOptions(screen.getByLabelText('Teaching mode'), 'ONLINE')
  await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.getByLabelText('Education level')).toHaveValue('')
  expect(screen.getByLabelText('Subject')).toHaveValue('')
  expect(screen.getByLabelText('Teaching mode')).toHaveValue('')
})

test('guests can distinguish edited filters from the results currently displayed', async () => {
  setup()
  await screen.findByRole('heading', { name: 'Daniel Tan' })
  const before = api.get.mock.calls.filter(([url]) => url === '/public/tutors').length
  await userEvent.selectOptions(screen.getByLabelText('Subject'), 'English')
  expect(screen.getByText(/Your filters have changed/)).toBeVisible()
  expect(api.get.mock.calls.filter(([url]) => url === '/public/tutors')).toHaveLength(before)
  await userEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/public/tutors', { params: expect.objectContaining({ subject: 'English' }) }))
  expect(screen.queryByText(/Your filters have changed/)).not.toBeInTheDocument()
})

test('failed searches offer a retry and recover without logging in', async () => {
  let fail = true
  api.get.mockImplementation(async url => {
    if (url === '/public/home') return { data: catalog }
    if (fail) throw new Error('offline')
    return { data: { tutors: [tutor], total: 1, totalPages: 1, page: 1 } }
  })
  setup()
  expect(await screen.findByRole('alert')).toHaveTextContent('Tutors could not be loaded.')
  fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('heading', { name: 'Daniel Tan' })).toBeVisible()
})

test('tutor and administrator accounts see a parent-account explanation instead of a wrong-portal booking link', async () => {
  auth = { user: { role: 'TUTOR' } }
  setup()
  await screen.findByRole('heading', { name: 'Daniel Tan' })
  expect(screen.getByText('Use a parent account to book lessons.')).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Book a Lesson' })).not.toBeInTheDocument()
})
