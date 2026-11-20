// Jest setup (runs before every test file): point Prisma at the TEST database and set the secrets the app needs.
// dotenv never overrides variables that are already set, so this wins over backend/.env.
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { testDatabaseUrl } from '../../scripts/setup-test-db-url.js'

process.env.DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.NODE_ENV = 'test'
process.env.BANK_DETAILS_KEY = randomBytes(32).toString('hex')
// Local Gemini settings must never enable network calls or change CI behaviour.
process.env.AI_ASSISTANT_ENABLED = 'false'
process.env.GEMINI_API_KEY = ''
process.env.GEMINI_MODEL = ''
// Never send real emails / hit reCAPTCHA from tests
process.env.SMTP_USER = ''
process.env.WEB_PUSH_VAPID_SUBJECT = ''
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = ''
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = ''
process.env.RECAPTCHA_SECRET = ''
process.env.GOOGLE_CLIENT_ID = ''
process.env.GEOAPIFY_API_KEY = ''
process.env.TOYYIBPAY_SECRET_KEY = ''
process.env.TOYYIBPAY_CATEGORY_CODE = ''
process.env.TOYYIBPAY_BASE_URL = 'https://toyyibpay.com'
process.env.BILLPLZ_API_KEY = '' // tests always use the built-in test gateway
process.env.CLOUDINARY_CLOUD_NAME = ''
process.env.CLOUDINARY_API_KEY = ''
process.env.CLOUDINARY_API_SECRET = ''
