import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import FindTutor from '../pages/parent/FindTutor'
import api from '../api/client'

const { patchCriteria } = vi.hoisted(() => ({ patchCriteria: vi.fn() }))

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: String }))
vi.mock('../assistant/MatchingContext', () => ({ useMatching: () => ({
  catalog: { subjects: ['Mathematics', 'Chemistry'], subjectLevels: { Mathematics: ['PRIMARY', 'SECONDARY'], Chemistry: ['SECONDARY'] }, homeLocation: 'Kuala Lumpur' },
  kids: [{ educationLevel: 'SECONDARY', grade: 5, subject: 'Chemistry' }], kidsLoaded: true,
  patchCriteria,
}) }))
vi.mock('../components/PlaceSearch', () => ({ default: ({ value, onChange }) => <label>Location<input value={value} onChange={(e) => onChange(e.target.value)} /></label> }))

beforeEach(() => {
  api.get.mockReset()
  patchCriteria.mockClear()
  api.get.mockResolvedValue({ data: { tutors: [], total: 0, page: 1, totalPages: 1, pageSize: 9 } })
})

const open = () => render(<MemoryRouter><FindTutor /></MemoryRouter>)

test('searching by name alone removes prefilled child and location constraints and returns to page one', async () => {
  api.get.mockImplementation(async (_, { params }) => ({ data: {
    tutors: [remoteTutor], total: 12, page: params.page, totalPages: 2, pageSize: 9,
  } }))
  open()
  const name = await screen.findByRole('searchbox', { name: 'Tutor name' })
  expect(name).toHaveAttribute('maxlength', '80')
  fireEvent.click(await screen.findByRole('button', { name: 'Page 2' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params.page).toBe(2))
  const before = api.get.mock.calls.length
  fireEvent.change(name, { target: { value: '  Remote  ' } })
  expect(api.get).toHaveBeenCalledTimes(before)
  fireEvent.submit(screen.getByRole('form', { name: 'Search tutors' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual({ name: 'Remote', sort: 'recommended', page: 1, pageSize: 9 }))
  expect(api.get).toHaveBeenCalledTimes(before + 1)
  expect(name).toHaveValue('Remote')
  fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual({ name: 'Remote', sort: 'recommended', page: 2, pageSize: 9 }))
})

test('the filter disclosure keeps deliberate selections with a name, reports the applied count and clears the search', async () => {
  open()
  const disclosure = await screen.findByRole('button', { name: 'Filters, 3 applied' })
  expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  const panels = disclosure.getAttribute('aria-controls').split(' ').map(id => document.getElementById(id))
  expect(panels.every(panel => panel.classList.contains('hidden'))).toBe(true)
  fireEvent.click(disclosure)
  expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  expect(panels.every(panel => !panel.classList.contains('hidden'))).toBe(true)
  fireEvent.change(screen.getByRole('combobox', { name: /Subject/ }), { target: { value: 'Mathematics' } })
  fireEvent.click(screen.getByRole('button', { name: 'Teaching Mode' }))
  fireEvent.click(screen.getByRole('button', { name: 'Online', exact: true }))
  const name = screen.getByRole('searchbox', { name: 'Tutor name' })
  fireEvent.change(name, { target: { value: 'Aisha' } })
  fireEvent.click(screen.getByRole('button', { name: 'Show results' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual({ name: 'Aisha', subject: 'Mathematics', mode: 'ONLINE', sort: 'recommended', page: 1, pageSize: 9 }))
  expect(disclosure).toHaveAccessibleName('Filters, 2 applied')
  expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(disclosure)
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(name).toHaveValue('')
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual({ sort: 'recommended', page: 1, pageSize: 9 }))
  expect(disclosure).toHaveTextContent(/^Filters$/)
})

test('changing Form 5 to Primary 1 removes Chemistry and allows all subjects for the selected grade', async () => {
  open()
  const subject = await screen.findByRole('combobox', { name: /Subject/ })
  expect(subject).toHaveValue('Chemistry')
  fireEvent.change(screen.getByRole('combobox', { name: /Education Level/ }), { target: { value: 'PRIMARY:1' } })
  expect(subject).toHaveValue('')
  expect(within(subject).queryByRole('option', { name: 'Chemistry' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual({ level: 'PRIMARY', grade: 1, location: 'Kuala Lumpur', sort: 'recommended', page: 1, pageSize: 9 }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.change(subject, { target: { value: 'Mathematics' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toMatchObject({ subject: 'Mathematics', level: 'PRIMARY', grade: 1 }))
  fireEvent.change(screen.getByRole('combobox', { name: /Education Level/ }), { target: { value: 'SECONDARY:5' } })
  expect(subject).toHaveValue('Mathematics')
  expect(within(subject).getByRole('option', { name: 'Chemistry' })).toBeInTheDocument()
})

test('Clear filters clears every field and extra filter, then an empty search browses all tutors', async () => {
  open()
  await screen.findByRole('combobox', { name: /Subject/ })
  fireEvent.click(screen.getByRole('button', { name: 'Price' }))
  fireEvent.click(screen.getByRole('button', { name: 'Under 50' }))
  fireEvent.click(screen.getByRole('button', { name: 'Select date & time' }))
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-01-01' } })
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  fireEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort by:' }), { target: { value: 'price_asc' } })
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toMatchObject({ maxPrice: 49, date: '2027-01-01', time: '09:00', location: 'Kuala Lumpur', sort: 'price_asc' }))
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.getByLabelText('Location')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Select date & time' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: /Subject/ })).toHaveValue('')
  expect(screen.getByRole('combobox', { name: /Education Level/ })).toHaveValue('')
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual({ sort: 'recommended', page: 1, pageSize: 9 }))
  fireEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api.get.mock.lastCall[1].params).toEqual({ sort: 'recommended', page: 1, pageSize: 9 })
})

test('a subject can be searched across all education levels', async () => {
  open()
  await screen.findByRole('combobox', { name: /Subject/ })
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  fireEvent.change(screen.getByRole('combobox', { name: /Subject/ }), { target: { value: 'Mathematics' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual({ subject: 'Mathematics', sort: 'recommended', page: 1, pageSize: 9 }))
})

test('clearing after an incompatible level change does not retain the previous applied subject', async () => {
  open()
  await screen.findByRole('combobox', { name: /Subject/ })
  fireEvent.change(screen.getByRole('combobox', { name: /Education Level/ }), { target: { value: 'PRIMARY:1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual({ sort: 'recommended', page: 1, pageSize: 9 }))
  expect(screen.getByRole('combobox', { name: /Education Level/ })).toHaveValue('')
})

test('an optional availability search still requires both date and time', async () => {
  open()
  await screen.findByRole('combobox', { name: /Subject/ })
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual({ sort: 'recommended', page: 1, pageSize: 9 }))
  const count = api.get.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'Select date & time' }))
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-01-01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  fireEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Choose both a date and a start time')
  expect(api.get).toHaveBeenCalledTimes(count)
})

test('opening AI matching from an empty browse search does not pass an invalid grade', async () => {
  open()
  await screen.findByRole('combobox', { name: /Subject/ })
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  fireEvent.click(screen.getByRole('button', { name: 'Try AI Matching' }))
  expect(patchCriteria).toHaveBeenCalledWith({ subject: '', level: '', grade: null, location: '', childId: null })
})

test('editing the search shows an unapplied-change notice and submitting the form applies it', async () => {
  open()
  await screen.findByRole('heading', { name: 'No tutors found' })
  const before = api.get.mock.calls.length
  fireEvent.change(screen.getByRole('combobox', { name: /Subject/ }), { target: { value: 'Mathematics' } })
  expect(screen.getByText(/Your filters have changed/)).toBeVisible()
  expect(api.get).toHaveBeenCalledTimes(before)
  fireEvent.submit(screen.getByRole('form', { name: 'Search tutors' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params.subject).toBe('Mathematics'))
  expect(screen.queryByText(/Your filters have changed/)).not.toBeInTheDocument()
})

test('a failed search hides stale cards and retry retains the applied search fields', async () => {
  api.get.mockResolvedValueOnce({ data: { tutors: [remoteTutor], total: 1, page: 1, totalPages: 1, pageSize: 9 } })
  open()
  await screen.findByRole('heading', { name: remoteTutor.name })
  api.get.mockRejectedValueOnce(new Error('Please try again later'))
  fireEvent.change(screen.getByRole('combobox', { name: /Subject/ }), { target: { value: 'Mathematics' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Search tutors' }))
  expect(await screen.findByText("We couldn't load tutors")).toBeVisible()
  expect(screen.queryByRole('heading', { name: remoteTutor.name })).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: /Subject/ })).toHaveValue('Mathematics')
  const failedQuery = api.get.mock.lastCall[1].params
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual(failedQuery))
  expect(await screen.findByRole('heading', { name: 'No tutors found' })).toBeVisible()
})

test('old tutor cards cannot be acted on while a replacement search is pending', async () => {
  api.get.mockResolvedValueOnce({ data: { tutors: [remoteTutor], total: 1, page: 1, totalPages: 1, pageSize: 9 } })
  open()
  await screen.findByRole('heading', { name: remoteTutor.name })
  let resolveSearch
  api.get.mockImplementationOnce(() => new Promise(resolve => { resolveSearch = resolve }))
  fireEvent.change(screen.getByRole('combobox', { name: /Subject/ }), { target: { value: 'Mathematics' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Search tutors' }))
  expect(screen.getByRole('region', { name: 'Tutor results' })).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByText('Updating tutor results…')).toBeVisible()
  expect(screen.getByRole('heading', { name: remoteTutor.name }).closest('[inert]')).not.toBeNull()
  resolveSearch({ data: { tutors: [], total: 0, page: 1, totalPages: 1, pageSize: 9 } })
  await screen.findByRole('heading', { name: 'No tutors found' })
  expect(screen.getByRole('region', { name: 'Tutor results' })).toHaveAttribute('aria-busy', 'false')
})

const remoteTutor = { id: 18, name: 'Remote English Tutor', photoUrl: null, rating: 4.5, reviewCount: 2, hourlyRate: 55, mainSubject: 'English', levels: 'Primary 1–6', offersOnline: true, offersPhysical: true, location: 'Bayan Lepas, Pulau Pinang', availableDays: ['Mon'], characteristics: [], searchMode: 'ONLINE', match: { score: 90, label: 'Highly suitable', reasons: ['Offers online lessons'], distanceKm: null } }

test('no nearby result shows online alternatives separately and carries Online into booking', async () => {
  api.get.mockResolvedValue({ data: { total: 0, tutors: [], page: 1, totalPages: 1,
    searchScope: { mode: 'PHYSICAL', location: 'Kuala Terengganu, Terengganu', radiusKm: 30 },
    onlineAlternatives: { total: 1, tutors: [remoteTutor], page: 1, totalPages: 1 },
  } })
  open()
  expect(await screen.findByText('No nearby tutors found')).toBeVisible()
  const alternatives = screen.getByRole('region', { name: 'Online alternatives' })
  expect(within(alternatives).getByRole('heading', { name: remoteTutor.name })).toBeVisible()
  expect(within(alternatives).getByText('Online')).toBeVisible()
  expect(within(alternatives).queryByText('Physical')).not.toBeInTheDocument()
  expect(within(alternatives).getByRole('link', { name: 'Book a Lesson' })).toHaveAttribute('href', '/parent/tutors/18/book?mode=ONLINE')
})

test('selecting Online reruns the search and replaces the local fallback with nationwide primary results', async () => {
  api.get.mockImplementation(async (_, options) => ({ data: options.params.mode === 'ONLINE'
    ? { total: 1, tutors: [remoteTutor], page: 1, totalPages: 1, searchScope: { mode: 'ONLINE' } }
    : { total: 0, tutors: [], page: 1, totalPages: 1, searchScope: { mode: 'PHYSICAL', radiusKm: 30, location: 'Kuala Lumpur' }, onlineAlternatives: { total: 1, tutors: [remoteTutor], page: 1, totalPages: 1 } },
  }))
  open()
  await screen.findByText('No nearby tutors found')
  fireEvent.click(screen.getByRole('button', { name: 'Teaching Mode' }))
  fireEvent.click(screen.getByRole('button', { name: 'Online', exact: true }))
  expect(await screen.findByText('Online lessons across Malaysia. Distance does not limit these results.')).toBeVisible()
  expect(screen.queryByRole('region', { name: 'Online alternatives' })).not.toBeInTheDocument()
  expect(api.get.mock.lastCall[1].params.mode).toBe('ONLINE')
})
