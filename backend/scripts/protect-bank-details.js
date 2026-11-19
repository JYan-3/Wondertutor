import 'dotenv/config'
import { prisma } from '../src/config/prisma.js'
import { protectBank, readBank } from '../src/services/bankDetails.js'

try {
  let after = 0
  for (;;) {
    const rows = await prisma.bankAccount.findMany({ where: { id: { gt: after } }, orderBy: { id: 'asc' }, take: 100 })
    if (!rows.length) break
    for (const row of rows) {
      if (row.accountNumber.length === 4) readBank(row)
      else await prisma.bankAccount.update({ where: { id: row.id }, data: protectBank(row) })
      after = row.id
    }
  }
  console.log('Payout account protection checked.')
} catch {
  console.error('Payout account protection failed. Check the database migration and BANK_DETAILS_KEY before retrying.')
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
