/**
 * .miga credential file — AES-256-GCM encrypt / decrypt
 *
 * File format (binary):
 *   [4]  Magic bytes: "MIGA"
 *   [1]  Version: 0x01
 *   [1]  Flags:   0x00 = no user password, 0x01 = password-protected
 *   [16] Salt     (random, used for PBKDF2 key derivation)
 *   [12] Nonce    (random, AES-GCM IV)
 *   [N]  AES-256-GCM ciphertext
 *   [16] GCM auth tag (appended after ciphertext)
 *
 * Key derivation:  PBKDF2-HMAC-SHA256(passphrase, salt, 100 000 iters) → 32 bytes
 *   No password:   passphrase = app secret (deployment-specific, NOT in source —
 *                  see loadAppSecret below). Legacy scheme; .miga v2 will require
 *                  a user passphrase and drop this mode entirely.
 *   With password: passphrase = user-supplied password
 */

const crypto = require('crypto')
const fs     = require('fs')

// ── Constants ─────────────────────────────────────────────────────────────────

const MAGIC   = Buffer.from('MIGA')
const VERSION = 0x01
const FLAG_NO_PASSWORD = 0x00
const FLAG_PASSWORD    = 0x01

// App secret for password-less .miga files. Never committed: each deployment
// supplies its own via the HORMIGA_APP_SECRET env var or an untracked
// electron/app_secret.local.js (module.exports = 'secret'). Without one,
// password-less .miga files cannot be created or opened — set a file password.
function loadAppSecret() {
  if (process.env.HORMIGA_APP_SECRET) return process.env.HORMIGA_APP_SECRET
  try { return require('./app_secret.local.js') } catch { return null }
}
const APP_SECRET = loadAppSecret()

function requireAppSecret() {
  if (!APP_SECRET) {
    throw new Error(
      'This .miga file has no password and no app secret is configured. ' +
      'Set HORMIGA_APP_SECRET or electron/app_secret.local.js, or use a password-protected file.'
    )
  }
  return APP_SECRET
}

// ── Key derivation ────────────────────────────────────────────────────────────

function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256')
}

// ── Core encrypt / decrypt ────────────────────────────────────────────────────

/**
 * Encrypt a plain-JS payload object into a .miga Buffer.
 * @param {object} payload   JSON-serialisable credential bundle
 * @param {string|null} password  Optional user password
 * @returns {Buffer}
 */
function encrypt(payload, password = null) {
  const salt       = crypto.randomBytes(16)
  const nonce      = crypto.randomBytes(12)
  const passphrase = password || requireAppSecret()
  const key        = deriveKey(passphrase, salt)

  const cipher     = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const plaintext  = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag        = cipher.getAuthTag() // 16 bytes

  return Buffer.concat([
    MAGIC,
    Buffer.from([VERSION, password ? FLAG_PASSWORD : FLAG_NO_PASSWORD]),
    salt,
    nonce,
    ciphertext,
    tag,
  ])
}

/**
 * Decrypt a .miga Buffer back into the payload object.
 * @param {Buffer} buf
 * @param {string|null} password
 * @returns {object}
 * @throws {'PASSWORD_REQUIRED'} when file is password-protected and no password given
 * @throws {Error} on bad magic, wrong password, or corrupted file
 */
function decrypt(buf, password = null) {
  if (!buf.slice(0, 4).equals(MAGIC)) {
    throw new Error('Not a valid .miga file.')
  }

  const version = buf[4]
  if (version !== VERSION) {
    throw new Error(`Unsupported .miga version: ${version}`)
  }

  const hasPassword = buf[5] === FLAG_PASSWORD

  if (hasPassword && !password) {
    const err = new Error('Password required.')
    err.code  = 'PASSWORD_REQUIRED'
    throw err
  }

  const salt             = buf.slice(6, 22)
  const nonce            = buf.slice(22, 34)
  const ciphertextAndTag = buf.slice(34)
  const tag              = ciphertextAndTag.slice(-16)
  const ciphertext       = ciphertextAndTag.slice(0, -16)

  const passphrase = (hasPassword && password) ? password : requireAppSecret()
  const key        = deriveKey(passphrase, salt)

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw new Error('Decryption failed — wrong password or corrupted file.')
  }
}

// ── File helpers ──────────────────────────────────────────────────────────────

function encryptToFile(payload, filePath, password = null) {
  fs.writeFileSync(filePath, encrypt(payload, password))
}

function decryptFromFile(filePath, password = null) {
  return decrypt(fs.readFileSync(filePath), password)
}

module.exports = { encrypt, decrypt, encryptToFile, decryptFromFile }
