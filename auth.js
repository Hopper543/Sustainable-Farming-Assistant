// auth.js — turning passwords into safe, one-way hashes.
// We NEVER store the real password. We store a salt + scrypt hash,
// and to check a login we hash the attempt and compare.

const crypto = require('crypto');

// Create a salted hash from a plain password. Stored as "salt:hash".
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex'); // unique per user
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Check a plain password against a stored "salt:hash".
function verifyPassword(password, stored) {
  const [salt, originalHash] = stored.split(':');
  const originalBuf = Buffer.from(originalHash, 'hex');
  const attemptBuf = crypto.scryptSync(password, salt, 64);
  // timingSafeEqual avoids leaking info through how long the compare takes
  return originalBuf.length === attemptBuf.length
    && crypto.timingSafeEqual(originalBuf, attemptBuf);
}

module.exports = { hashPassword, verifyPassword };