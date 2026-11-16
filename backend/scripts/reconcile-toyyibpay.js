import 'dotenv/config'
import { prisma } from '../src/config/prisma.js'
import { getBillTransactions, toyyibPayConfigured, toyyibPayMethod } from '../src/services/toyyibpay.service.js'
import { paymentReference, settleFromToyyibPay } from '../src/services/toyyibpayPayments.service.js'

// Inspect by default. --apply records a provider-verified result using the same
// settlement rules as the callback; it cannot force a bank payment to succeed.
const [publicId, billCode, action] = process.argv.slice(2)
const fail = message => { const error = new Error(message); error.safe = true; throw error }
try {
  if (!toyyibPayConfigured() || !/^[a-f0-9-]{36}$/i.test(publicId || '') ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(billCode || '') || (action && action !== '--apply')) {
    fail('Usage: node scripts/reconcile-toyyibpay.js PAYMENT_PUBLIC_UUID ORIGINAL_BILL_CODE [--apply] (configure ToyyibPay first)')
  }
  const payment = await prisma.payment.findFirst({ where: { publicId, method: toyyibPayMethod() } })
  if (!payment) fail('ToyyibPay payment for this environment was not found')
  if (payment.gatewayRef && payment.gatewayRef !== billCode) fail('The original bill reference does not match')
  const transactions = await getBillTransactions(billCode)
  console.log(JSON.stringify({ reference: paymentReference(payment), localStatus: payment.status, providerTransactionCount: transactions.length,
    providerStatuses: [...new Set(transactions.map(t => String(t.billpaymentStatus)))], referenceMatches: transactions.length > 0 && transactions.every(t => t.billExternalReferenceNo === paymentReference(payment)),
  }))
  if (action === '--apply') {
    const checked = await settleFromToyyibPay(billCode, { orderId: paymentReference(payment), expectedBookingId: payment.bookingId })
    if (checked.result === 'WAITING' && !checked.payment.gatewayRef) {
      console.log('No verifiable transaction yet. Check the original bill and its reference/amount in the merchant dashboard; do not create another bill.')
    } else console.log('Verified result:', checked.result)
  } else console.log('Inspection only. Use --apply to record a verified result; no payer details or merchant credentials are printed.')
} catch (error) {
  console.error(error.safe ? error.message : 'The provider result could not be verified; check the protected database/provider configuration. No forced settlement was performed.')
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
