import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function bankKey() {
  const key = process.env.BANK_DETAILS_KEY
  if (!/^[a-f\d]{64}$/i.test(key || '')) throw new Error('Configure BANK_DETAILS_KEY before using payout accounts')
  return Buffer.from(key, 'hex')
}

const context = (bank, suffix) => Buffer.from(JSON.stringify(['bank-v1', bank, suffix]))

// Keep only the display suffix readable. Authenticate it and the bank alongside the encrypted details.
export function protectBank({ bankName, accountName, accountNumber }) {
  const suffix = accountNumber.slice(-4)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', bankKey(), iv)
  cipher.setAAD(context(bankName, suffix))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify([accountName, accountNumber]), 'utf8'), cipher.final()])
  const envelope = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
  return { bankName, accountName: 'v1:' + envelope, accountNumber: suffix }
}

export function readBank(row) {
  if (row.accountNumber.length !== 4) return row // Legacy accounts are converted during deployment.
  if (!row.accountName.startsWith('v1:')) throw new Error('Invalid payout account')
  const bytes = Buffer.from(row.accountName.slice(3), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', bankKey(), bytes.subarray(0, 12))
  decipher.setAAD(context(row.bankName, row.accountNumber))
  decipher.setAuthTag(bytes.subarray(12, 28))
  const [accountName, accountNumber] = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString())
  return { ...row, accountName, accountNumber }
}
