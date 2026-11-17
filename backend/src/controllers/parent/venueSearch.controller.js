import { z } from 'zod'
import { searchVenuePlaces, venueSearchCapabilities } from '../../services/venueSearch.service.js'

const querySchema = z.object({ query: z.string().trim().min(3, 'Enter at least 3 characters.').max(120, 'Keep the search to 120 characters or fewer.') }).strict()

export function capabilities(_req, res) {
  res.set('Cache-Control', 'no-store').json(venueSearchCapabilities())
}

export async function search(req, res) {
  const { query } = querySchema.parse(req.body)
  res.set('Cache-Control', 'no-store').json(await searchVenuePlaces(query))
}
