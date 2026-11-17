import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import MatchResults from '../pages/parent/MatchResults'
import api from '../api/client'

let matching
vi.mock('../assistant/MatchingContext', () => ({ useMatching: () => matching }))
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: () => 'Unable to update the search.' }))
const tutor = { id: 7, name: 'Online Tutor', photoUrl: null, rating: 4.8, reviewCount: 3, hourlyRate: 50, mainSubject: 'English', levels: 'Primary 1–6', location: 'Bayan Lepas, Pulau Pinang', availableDays: ['Mon'], offersOnline: true, offersPhysical: true, characteristics: [], searchMode: 'ONLINE', match: { score: 94, label: 'Highly suitable', reasons: ['Offers online lessons'], distanceKm: null } }
const original = () => ({ temporary: true, criteria: { subject: 'English', level: 'PRIMARY', grade: 5, mode: 'PHYSICAL', location: 'Kuala Terengganu, Terengganu' }, total: 0, tutors: [], searchScope: { mode: 'PHYSICAL', radiusKm: 30, location: 'Kuala Terengganu, Terengganu' }, onlineAlternatives: { total: 1, tutors: [tutor] } })
const open = () => render(<MemoryRouter><MatchResults /></MemoryRouter>)
beforeEach(() => {
  vi.clearAllMocks()
  matching = { result: original(), setResult: vi.fn(), setCriteria: vi.fn() }
})

test('wizard results keep the physical zero-result message separate from online alternatives', () => {
  open()
  expect(screen.getByText('No nearby tutors found')).toBeVisible()
  const alternatives = screen.getByRole('region', { name: 'Online alternatives' })
  expect(within(alternatives).getByRole('heading', { name: 'Online Tutor' })).toBeVisible()
  expect(within(alternatives).getByRole('link', { name: 'Book a Lesson' })).toHaveAttribute('href', '/parent/tutors/7/book?mode=ONLINE')
  expect(screen.queryByText('No eligible tutors yet')).not.toBeInTheDocument()
})

test('Klang guided matching identifies an Ipoh tutor as an online alternative, not a nearby physical match', () => {
  matching.result = { ...original(), temporary: false,
    criteria: { subject: 'Tamil', level: 'PRIMARY', grade: 1, mode: 'EITHER', location: 'Klang, Selangor' },
    searchScope: { mode: 'PHYSICAL', radiusKm: 30, location: 'Klang, Selangor' },
    onlineAlternatives: { total: 1, tutors: [{ ...tutor, id: 30, name: 'Kavitha Devi', mainSubject: 'Tamil', location: 'Ipoh, Perak' }] },
  }
  open()
  expect(screen.getByText('No physical tutors match your current filters near Klang, Selangor. 1 online alternative is available across Malaysia.')).toBeVisible()
  const alternatives = screen.getByRole('region', { name: 'Online alternatives' })
  expect(within(alternatives).getByText('Based in Ipoh, Perak')).toBeVisible()
  expect(within(alternatives).getByText(/The listed city is where the tutor is based; these lessons are online/)).toBeVisible()
  expect(within(alternatives).getByText('Online', { exact: true })).toBeVisible()
  expect(within(alternatives).queryByText('Physical', { exact: true })).not.toBeInTheDocument()
  expect(within(alternatives).getByRole('link', { name: 'Book a Lesson' })).toHaveAttribute('href', '/parent/tutors/30/book?mode=ONLINE')
  expect(screen.queryByText(/We found 0 tutors/)).not.toBeInTheDocument()
})

test('nearby physical results stay separate from nationwide online alternatives', () => {
  matching.result = { ...original(), total: 1, tutors: [{ ...tutor, name: 'Nearby Tutor', location: 'Kuala Terengganu, Terengganu', searchMode: 'PHYSICAL', offersOnline: false }] }
  open()
  expect(screen.getByText('We found 1 nearby physical tutor for your search.')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Nearby Tutor' })).toBeVisible()
  expect(screen.queryByRole('region', { name: 'Online alternatives' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Based in/)).not.toBeInTheDocument()
})

test('switching result mode recomputes through a read-only preview instead of filtering stale local scores', async () => {
  api.post.mockResolvedValue({ data: { criteria: { ...original().criteria, mode: 'ONLINE' }, total: 1, tutors: [tutor], searchScope: { mode: 'ONLINE' }, onlineAlternatives: { total: 0, tutors: [] } } })
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Teaching Mode' }))
  fireEvent.click(screen.getByRole('button', { name: 'Online', exact: true }))
  expect(await screen.findByText('Online lessons across Malaysia. Distance does not limit these results.')).toBeVisible()
  expect(screen.getByText('We found 1 online tutor for your search.')).toBeVisible()
  expect(api.post).toHaveBeenCalledWith('/parent/matching/preview', { criteria: expect.objectContaining({ subject: 'English', mode: 'ONLINE', location: 'Kuala Terengganu, Terengganu' }) })
  expect(screen.queryByRole('region', { name: 'Online alternatives' })).not.toBeInTheDocument()
  expect(screen.getByText(/not saved/)).toBeVisible()
})

test('a failed scope refresh preserves the previous results and lets the parent retry', async () => {
  api.post.mockRejectedValue(new Error('offline'))
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Teaching Mode' }))
  fireEvent.click(screen.getByRole('button', { name: 'Online', exact: true }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to update the search.'))
  expect(screen.getByText('No nearby tutors found')).toBeVisible()
  expect(screen.getByRole('region', { name: 'Online alternatives' })).toBeVisible()
})
