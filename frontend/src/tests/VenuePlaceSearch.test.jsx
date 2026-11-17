import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import VenuePlaceSearch from '../components/VenuePlaceSearch'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: error => error.message }))
const place = { label: 'Example Library, Klang, Selangor', kind: 'amenity', lat: 3.04, lng: 101.45, zoom: 17 }
const result = { data: { provider: 'geoapify', results: [place], message: '' } }
async function ready(props = {}) {
  const choose = vi.fn()
  const view = render(<VenuePlaceSearch onChoose={choose} {...props} />)
  const input = await screen.findByRole('combobox', { name: 'Find a building, street or postcode' })
  return { input, choose, view }
}
beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ data: { externalSearch: true, provider: 'geoapify' } })
  api.post.mockResolvedValue(result)
})
afterEach(() => vi.useRealTimers())

test('search is opt-in, waits for three characters and debounces before sending only the search text', async () => {
  const { input } = await ready()
  expect(api.post).not.toHaveBeenCalled()
  vi.useFakeTimers()
  fireEvent.change(input, { target: { value: 'Kl' } })
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: 'Klang' } })
  await act(() => vi.advanceTimersByTimeAsync(449))
  expect(api.post).not.toHaveBeenCalled()
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(api.post).toHaveBeenCalledWith('/parent/venue-search', { query: 'Klang' }, { signal: expect.any(AbortSignal) })
})

test('a selected result is keyboard accessible and shows the required attribution', async () => {
  const { input, choose } = await ready()
  fireEvent.change(input, { target: { value: 'Example Library' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
  const option = await screen.findByRole('option', { name: /Example Library/ })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(input).toHaveAttribute('aria-activedescendant', option.id)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(choose).toHaveBeenCalledWith(place)
  expect(input).toHaveValue(place.label)
  expect(input).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('link', { name: 'Geoapify' })).toHaveAttribute('href', 'https://www.geoapify.com/')
  expect(screen.getByText(/Only text typed in this search box/)).toBeVisible()
  expect(api.post).toHaveBeenCalledTimes(1)
})

test('a late response cannot reopen a dismissed result list', async () => {
  let finish
  api.post.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { input } = await ready()
  fireEvent.change(input, { target: { value: 'Library' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  fireEvent.keyDown(input, { key: 'Escape' })
  await act(async () => finish(result))
  expect(input).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('a stale query response cannot replace newer results', async () => {
  let finish
  api.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(result)
  const { input } = await ready()
  fireEvent.change(input, { target: { value: 'First place' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  fireEvent.change(input, { target: { value: 'Library' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
  await screen.findByRole('option', { name: /Example Library/ })
  await act(async () => finish({ data: { ...result.data, results: [{ ...place, label: 'Old result' }] } }))
  expect(screen.queryByText('Old result')).not.toBeInTheDocument()
})

test('failed requests preserve the search and can be retried without losing the map fallback', async () => {
  api.post.mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce(result)
  const { input } = await ready()
  fireEvent.change(input, { target: { value: 'Library' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent('You can still use the map or GPS')
  expect(input).toHaveValue('Library')
  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
  expect(await screen.findByRole('option', { name: /Example Library/ })).toBeVisible()
})

test('local fallback is clearly labelled and still supports selecting an approximate area', async () => {
  api.get.mockResolvedValue({ data: { externalSearch: false } })
  api.post.mockResolvedValue({ data: { provider: 'local', results: [{ ...place, label: 'Klang, Selangor', kind: 'town', zoom: 12 }], message: 'Town results show an approximate area.' } })
  const choose = vi.fn()
  render(<VenuePlaceSearch onChoose={choose} />)
  const input = await screen.findByRole('combobox', { name: 'Find a town or postcode' })
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: 'Klang' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
  fireEvent.click(await screen.findByRole('option', { name: /Klang, Selangor/ }))
  expect(choose).toHaveBeenCalledWith(expect.objectContaining({ zoom: 12, kind: 'town' }))
  expect(screen.getByText('Town results show an approximate area.')).toBeVisible()
})
