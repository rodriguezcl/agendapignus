const crypto = require('node:crypto')

function publicEmployee(employee = {}) {
  const { password, passwordHash, ...safe } = employee
  return safe
}

function auditSafe(record) {
  if (!record) return null
  const { password, passwordHash, ...safe } = record
  return safe
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`
}

function verifyPassword(password, storedHash) {
  if (!storedHash?.includes(':')) return false
  const [salt, hash] = storedHash.split(':')
  const calculated = crypto.scryptSync(String(password), salt, 64)
  const stored = Buffer.from(hash, 'hex')
  return stored.length === calculated.length && crypto.timingSafeEqual(stored, calculated)
}

module.exports = { publicEmployee, auditSafe, hashPassword, verifyPassword }
