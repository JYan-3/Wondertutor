import { homeFor } from '../components/ProtectedRoute'

// Public guidance follows the existing booking, verification and lesson flows.
export const PUBLIC_GUIDES = {
  parents: {
    label: 'For Parents',
    title: 'Find the right support for your child.',
    introduction: 'Get to know the tutors, choose lessons around your family and stay involved as your child learns. Start by exploring, at your own pace.',
    highlights: ['Browse tutor profiles before signing up', 'Choose online or nearby physical lessons', 'Keep bookings and learning updates together'],
    panelTitle: 'A good fit starts with your child',
    panelItems: [
      ['book', 'What they learn', 'Their subjects, school level and grade.'],
      ['user', 'How they learn', 'Their goals, language and learning preferences.'],
      ['pin', 'Where they learn', 'Online, or a physical lesson near your area.'],
    ],
    benefits: [
      ['search', 'Choose with more confidence', 'Compare teaching experience, qualifications, rates and parent reviews. Look for the verified badge to see which tutors have approved identity and qualification documents.'],
      ['calendar', 'Find room in your week', 'Pick available one-hour slots on different dates. The calendar checks each date, lesson mode and existing bookings before a request is sent.'],
      ['chart', 'Follow the learning journey', 'See recorded attendance, lesson summaries and homework for your child. Keep payment receipts and feedback alongside your booking records.'],
    ],
    steps: [
      { icon: 'search', title: 'Explore and compare tutors', text: 'Browse public profiles by subject, education level and location. Physical searches look for nearby tutors; online lessons can connect you with tutors across Malaysia.' },
      { icon: 'user', title: 'Tell us about your child', text: 'Create a parent account and add your child’s level, grade and subjects. Use the search filters, Guided Tutor Search or AI assistant to help narrow down suitable tutors.' },
      { icon: 'calendar', title: 'Request lessons, then confirm', text: 'Choose available dates, propose an hourly price and send your request. Check the tutor’s response in My Bookings. Once the price is agreed, pay by the displayed deadline to confirm the lesson.' },
      { icon: 'book', title: 'Learn, follow up and review', text: 'Open the lesson details for its online meeting link or confirmed physical venue. After the lesson, check available notes and homework, and leave a review when it is completed.' },
    ],
    noteTitle: 'A request becomes a lesson after payment',
    note: 'Sending a request does not reserve a confirmed lesson. After acceptance, payment is due within 24 hours or one hour before the lesson starts, whichever comes first. My Bookings shows the deadline and current status.',
    questions: [
      ['Do I need an account to look at tutors?', 'You can browse tutor profiles without signing in. Create a parent account when you are ready to add your child and send a booking request.'],
      ['Can I book more than one lesson?', 'Yes. Select available one-hour slots on different dates. Each selected lesson keeps its own booking and payment status, so check the response and deadline for each one.'],
      ['What if something goes wrong?', 'Open the booking details to see available cancellation, rescheduling or refund-request options. You can also submit a private complaint for administrator review. A refund request does not mean money has already been returned.'],
    ],
    finalTitle: 'Let’s find a tutor who fits.',
    finalText: 'Explore the profiles first. Create your account when you are ready to take the next step.',
  },
  tutors: {
    label: 'For Tutors',
    title: 'Your teaching. Your schedule.',
    introduction: 'Show parents how you teach, choose the hours you can offer and manage your lessons in one place. Build a profile that reflects you.',
    highlights: ['Choose your subjects, levels and hourly rate', 'Offer online lessons, physical lessons or both', 'Manage regular hours and date-specific changes'],
    panelTitle: 'Help parents get to know your teaching',
    panelItems: [
      ['cap', 'Your experience', 'Subjects, qualifications and teaching approach.'],
      ['calendar', 'Your availability', 'Usual hours, one-week changes and individual dates.'],
      ['monitor', 'Your lesson options', 'Online or physical availability for each time slot.'],
    ],
    benefits: [
      ['user', 'Put your teaching into words', 'Share your background, teaching style and the levels you teach. Submit identity and qualification documents for administrator review and a verified badge.'],
      ['clock', 'Keep your availability realistic', 'Set your regular hours, change one week or adjust a single date. A date-specific change takes priority over the week’s schedule and usual hours.'],
      ['book', 'Keep every lesson organised', 'Respond to booking requests, record attendance and submit lesson notes. View lesson payments, commission and eligible withdrawal balance in Earnings.'],
    ],
    steps: [
      { icon: 'user', title: 'Create your tutor account', text: 'Choose Tutor during sign-up, enter your account details and verify your email. You can then complete your teaching profile in the Tutor Portal.' },
      { icon: 'cap', title: 'Introduce yourself and set your hours', text: 'Add subjects, levels, experience, your rate and lesson options. Upload verification documents for review, then set available hours and any changes for particular weeks or dates.' },
      { icon: 'calendar', title: 'Respond to lesson requests', text: 'Review the child, subject, time, lesson mode and proposed price. Accept, decline or send a counter-offer. An accepted lesson becomes confirmed after the parent’s payment is verified.' },
      { icon: 'book', title: 'Teach and record the progress', text: 'For physical lessons, check in using a photo and GPS at the confirmed lesson venue. Online lessons use in-app attendance. Check out and submit the lesson summary, progress notes and any homework.' },
    ],
    noteTitle: 'Your calendar stays in your control',
    note: 'A change for one date replaces that week’s hours for the date. Otherwise, a one-week change replaces the usual weekly schedule. Parents see the available lesson modes and bookable slots for their selected date.',
    questions: [
      ['Can I change just one day instead of my whole schedule?', 'Yes. Use date-specific availability for one day, a weekly change for one particular week, or update your usual weekly hours for an ongoing change.'],
      ['How do I get a verified badge?', 'Complete your profile and submit your identity and qualification documents. Administrators review the documents. The verified badge is shown when the required identity and qualification approvals are in place.'],
      ['Where can I see my earnings?', 'Open Earnings in the Tutor Portal to see lesson fees, commission and your eligible withdrawal balance. Add your bank details there and request a withdrawal when funds are available.'],
    ],
    finalTitle: 'Make room for your next learner.',
    finalText: 'Start with your account, then build your teaching profile and availability at your own pace.',
  },
}

export function guideActions(audience, user) {
  if (audience === 'parents') return [
    { to: user?.role === 'PARENT' ? '/parent/find-tutor' : '/tutors', label: 'Find a Tutor' },
    user ? { to: homeFor(user.role), label: 'My Dashboard' } : { to: '/signup?role=PARENT', label: 'Create a parent account' },
  ]
  if (user?.role === 'TUTOR') return [
    { to: '/tutor/setup', label: 'Edit my tutor profile' },
    { to: '/tutor/availability', label: 'Manage my availability' },
  ]
  return user ? [
    { to: homeFor(user.role), label: 'My Dashboard' },
    { to: '/how-it-works', label: 'See how it works' },
  ] : [
    { to: '/signup?role=TUTOR', label: 'Become a Tutor' },
    { to: '/login', label: 'Tutor log in' },
  ]
}
