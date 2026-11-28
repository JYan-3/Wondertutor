import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: (e) => e.message }))

import api from '../api/client'
import Students from '../pages/tutor/Students'

const sarah = { id: 1, name: 'Sarah Lim', educationLevel: 'PRIMARY', grade: 5 }
const adam = { id: 2, name: 'Adam Tan', educationLevel: 'PRIMARY', grade: 3 }
const lesson = (id, child, status, startAt = new Date(Date.now() + 86400000).toISOString(), subject = 'Mathematics') => ({ id, child, status, startAt, subject })

const show = (bookings) => {
  api.get.mockResolvedValue({ data: { bookings } })
  return render(<MemoryRouter><Students /></MemoryRouter>)
}
const student = name => screen.findByText(name, { selector: 'summary strong' })
const openStudent = group => { if (!group.open) fireEvent.click(group.querySelector('summary')) }
const summaries = () => Array.from(document.querySelectorAll('summary strong'), n => n.textContent)

beforeEach(() => { vi.resetAllMocks() })

test('loads the tutor lesson list', async () => {
  show([])
  await screen.findByText('No matching students.')
  expect(api.get).toHaveBeenCalledWith('/tutor/bookings', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

test('groups lessons by student and shows the grade and lesson count', async () => {
  show([lesson(1, sarah, 'CONFIRMED'), lesson(2, sarah, 'COMPLETED'), lesson(3, adam, 'CONFIRMED')])
  const group = (await student('Sarah Lim')).closest('details')
  expect(within(group).getByText('1 upcoming')).toBeInTheDocument()
  expect(within(group).getByText('1 completed')).toBeInTheDocument()
  expect(summaries()).toEqual(['Sarah Lim', 'Adam Tan'])
})

test('lists confirmed, completed and disputed lessons only', async () => {
  show([
    lesson(1, sarah, 'CONFIRMED'), lesson(2, sarah, 'COMPLETED'), lesson(3, sarah, 'DISPUTED'),
    lesson(4, sarah, 'PENDING'), lesson(5, sarah, 'CANCELLED'), lesson(6, sarah, 'REJECTED'), lesson(7, sarah, 'AWAITING_PAYMENT'),
  ])
  const group = (await student('Sarah Lim')).closest('details')
  openStudent(group)
  expect(within(group.querySelector('ul')).getAllByRole('link')).toHaveLength(3)
})

test('a child with only requests or cancelled lessons is not listed', async () => {
  show([lesson(1, adam, 'PENDING'), lesson(2, adam, 'CANCELLED')])
  expect(await screen.findByText('No matching students.')).toBeInTheDocument()
})

test('each lesson links to its session page with date, subject and status', async () => {
  show([lesson(9, sarah, 'COMPLETED', '2026-12-07T09:00:00.000Z', 'Science')])
  openStudent((await student('Sarah Lim')).closest('details'))
  const link = screen.getByRole('link', { name: /Science · completed/ })
  expect(link).toHaveAttribute('href', '/tutor/bookings/9/session')
  expect(link).toHaveTextContent('7 Dec 2026')
})

test('search finds a student by part of the name, ignoring case', async () => {
  show([lesson(1, sarah, 'CONFIRMED'), lesson(2, adam, 'CONFIRMED')])
  await student('Adam Tan')
  fireEvent.change(screen.getByLabelText('Find a student'), { target: { value: 'sAr' } })
  expect(summaries()).toEqual(['Sarah Lim'])
})

test('search with no match says so and clearing it shows everyone again', async () => {
  show([lesson(1, sarah, 'CONFIRMED'), lesson(2, adam, 'CONFIRMED')])
  await student('Adam Tan')
  const box = screen.getByLabelText('Find a student')
  fireEvent.change(box, { target: { value: 'zzz' } })
  expect(screen.getByText('No matching students.')).toBeInTheDocument()
  fireEvent.change(box, { target: { value: '' } })
  expect(summaries()).toHaveLength(2)
})

test('two children with the same name stay separate', async () => {
  show([lesson(1, sarah, 'CONFIRMED'), lesson(2, { ...sarah, id: 3, grade: 2 }, 'CONFIRMED')])
  expect(await screen.findAllByText('Sarah Lim', { selector: 'summary strong' })).toHaveLength(2)
  expect(screen.getByText(/Primary 2/, { selector: 'summary' })).toBeInTheDocument()
})

test("a student's lessons stay in the order the server sent them", async () => {
  show([lesson(1, sarah, 'COMPLETED', '2026-11-02T09:00:00.000Z'), lesson(2, sarah, 'CONFIRMED', '2026-12-07T09:00:00.000Z')])
  const group = (await student('Sarah Lim')).closest('details')
  openStudent(group)
  const links = within(group.querySelector('ul')).getAllByRole('link').map((a) => a.getAttribute('href'))
  expect(links).toEqual(['/tutor/bookings/1/session', '/tutor/bookings/2/session'])
})

test('a failed load can be retried', async () => {
  api.get.mockRejectedValueOnce(new Error('Network error')).mockResolvedValue({ data: { bookings: [lesson(1, sarah, 'CONFIRMED')] } })
  render(<MemoryRouter><Students /></MemoryRouter>)
  expect(await screen.findByText('Network error')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
  expect(await student('Sarah Lim')).toBeInTheDocument()
})

test('Ben’s disputed Mathematics lesson stays accessible and never counts as completed', async () => {
  const ben = { id: 3, name: 'Ben Lee (Demo)', educationLevel: 'PRIMARY', grade: 5 }
  const disputed = { ...lesson(9, ben, 'DISPUTED', '2026-10-27T09:00:00Z'), publicId: 'ben-session' }
  show([disputed, lesson(10, ben, 'CONFIRMED'), lesson(11, ben, 'CONFIRMED', '2020-01-01T09:00:00Z')])
  const group = (await student(ben.name)).closest('details')
  for (const count of ['1 upcoming', '0 completed', '1 disputed', '1 awaiting completion']) expect(within(group).getByText(count)).toBeVisible()
  openStudent(group)
  expect(within(group).getByRole('link', { name: /Mathematics · disputed/ })).toHaveAttribute('href', '/tutor/bookings/ben-session/session')
})

test('Iris sees Alya’s last completed report beside her earliest upcoming confirmed lesson', async () => {
  const alya = { ...sarah, name: 'Alya Lim (Demo)' }
  const future = days => new Date(Date.now() + days * 86400000).toISOString()
  show([
    { ...lesson(1, alya, 'COMPLETED', '2020-11-01'), report: { progressNote: 'Older report.' } },
    { ...lesson(2, alya, 'COMPLETED', '2020-11-03'), report: { progressNote: 'Solved four of five problems independently.', homework: 'Complete five fraction exercises.' } },
    { ...lesson(3, alya, 'DISPUTED', '2020-11-05'), report: { progressNote: 'Disputed report.' } },
    lesson(4, alya, 'CONFIRMED', '2020-11-06'), lesson(5, alya, 'CONFIRMED', future(1), 'Mathematics'), lesson(6, alya, 'CONFIRMED', future(2), 'Science'),
  ])
  openStudent((await student(alya.name)).closest('details'))
  expect(screen.getByText('Solved four of five problems independently.')).toBeVisible()
  expect(screen.getByText('Complete five fraction exercises.')).toBeVisible()
  expect(screen.queryByText('Older report.')).toBeNull()
  expect(screen.queryByText('Disputed report.')).toBeNull()
  expect(screen.getByText('Next confirmed lesson').parentElement).toHaveTextContent('Mathematics')
})

test('a missing latest report does not substitute older homework', async () => {
  show([{ ...lesson(1, sarah, 'COMPLETED', '2020-01-01'), report: { homework: 'Older homework' } }, lesson(2, sarah, 'COMPLETED', '2020-01-02')])
  openStudent((await student(sarah.name)).closest('details'))
  expect(screen.getByText('No report recorded for this lesson.')).toBeVisible()
  expect(screen.getByText('No upcoming confirmed lesson.')).toBeVisible()
  expect(screen.queryByText('Older homework')).toBeNull()
})

test('lesson history filters disputes without hiding the last completed report', async () => {
  show([
    { ...lesson(1, sarah, 'COMPLETED', '2020-01-01'), report: { progressNote: 'Understands fractions', homework: 'Five exercises' } },
    lesson(2, sarah, 'DISPUTED', '2020-02-01'), lesson(3, sarah, 'CONFIRMED'),
  ])
  openStudent((await student('Sarah Lim')).closest('details'))
  fireEvent.change(screen.getByRole('combobox', { name: 'Show lessons for Sarah Lim' }), { target: { value: 'disputed' } })
  expect(within(document.querySelector('details ul')).getAllByRole('link')).toHaveLength(1)
  expect(within(document.querySelector('details ul')).getByRole('link')).toHaveAttribute('href', '/tutor/bookings/2/session')
  expect(screen.getByText('Five exercises')).toBeVisible()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all' } })
  expect(within(document.querySelector('details ul')).getAllByRole('link')).toHaveLength(3)
})


test('the student selector opens another student without mixing their report', async () => {
  show([{ ...lesson(1, sarah, 'COMPLETED'), report: { homework: 'Sarah homework' } }, { ...lesson(2, adam, 'COMPLETED'), report: { homework: 'Adam homework' } }])
  await student('Sarah Lim')
  fireEvent.click(within(screen.getByRole('complementary', { name: 'Choose a student' })).getByRole('button', { name: /Adam Tan/ }))
  expect((await student('Adam Tan')).closest('details')).toHaveAttribute('open')
  expect((await student('Sarah Lim')).closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText('Adam homework')).toBeVisible()
})

test('paginates students and searches the entire list', async () => {
  const bookings = Array.from({ length: 23 }, (_, i) => lesson(i + 1, { ...sarah, id: i + 1, name: `Student ${String(i + 1).padStart(2, '0')}` }, 'CONFIRMED'))
  show(bookings)
  await student('Student 01')
  expect(summaries()).toHaveLength(5)
  expect(screen.getByText('Showing 1–5 of 23 students')).toBeVisible()
  const pages = within(screen.getByRole('navigation', { name: 'Student pages' }))
  fireEvent.click(pages.getByRole('button', { name: 'Next' }))
  expect(summaries()).toHaveLength(5)
  expect(summaries()[0]).toBe('Student 06')
  expect((await student('Student 06')).closest('details')).toHaveAttribute('open')
  fireEvent.click(pages.getByRole('button', { name: 'Page 5' }))
  expect(summaries()).toEqual(['Student 21', 'Student 22', 'Student 23'])
  expect(screen.getByText('Showing 21–23 of 23 students')).toBeVisible()
  const search = screen.getByLabelText('Find a student')
  fireEvent.change(search, { target: { value: 'student 02' } })
  expect(summaries()).toEqual(['Student 02'])
  fireEvent.change(search, { target: { value: '' } })
  expect(summaries()[0]).toBe('Student 01')
})

test('paginates filtered lesson history and keeps the latest report visible', async () => {
  const bookings = Array.from({ length: 23 }, (_, i) => ({
    ...lesson(i + 1, sarah, i < 13 ? 'COMPLETED' : 'DISPUTED', `2020-01-${String(i + 1).padStart(2, '0')}T09:00:00Z`),
    ...(i === 12 ? { report: { homework: 'Review fractions' } } : {}),
  }))
  show(bookings)
  const group = (await student('Sarah Lim')).closest('details')
  const links = () => within(group.querySelector('ul')).getAllByRole('link')
  expect(links()).toHaveLength(5)
  expect(within(group).getByText('Showing 1–5 of 23 lessons')).toBeVisible()
  let pages = within(within(group).getByRole('navigation', { name: 'Lesson history pages for Sarah Lim' }))
  fireEvent.click(pages.getByRole('button', { name: 'Next' }))
  expect(links()[0]).toHaveAttribute('href', '/tutor/bookings/6/session')
  fireEvent.click(within(group).getByRole('button', { name: 'completed (13)' }))
  expect(links()).toHaveLength(5)
  expect(links()[0]).toHaveAttribute('href', '/tutor/bookings/1/session')
  expect(within(group).getByText('Showing 1–5 of 13 lessons')).toBeVisible()
  pages = within(within(group).getByRole('navigation', { name: 'Lesson history pages for Sarah Lim' }))
  fireEvent.click(pages.getByRole('button', { name: 'Next' }))
  expect(links()).toHaveLength(5)
  expect(links()[0]).toHaveAttribute('href', '/tutor/bookings/6/session')
  expect(within(group).getByText('Review fractions')).toBeVisible()
  fireEvent.change(within(group).getByRole('combobox', { name: 'Show lessons for Sarah Lim' }), { target: { value: 'disputed' } })
  expect(links()).toHaveLength(5)
  expect(links()[0]).toHaveAttribute('href', '/tutor/bookings/14/session')
  expect(within(group).getByText('Showing 1–5 of 10 lessons')).toBeVisible()
})
