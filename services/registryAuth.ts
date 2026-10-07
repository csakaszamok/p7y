import crypto from 'node:crypto'
import fs from 'fs'
import forge from 'node-forge'
import type { RegistryAccess } from './registryAccess'

// The registry container reads the certificate from here (./data is mounted at /app/data); tests set a temp dir
const authDir = () => process.env.REGISTRY_AUTH_DIR ?? '/app/data'
const keyPath = () => `${authDir()}/registry-auth.key`
const certPath = () => `${authDir()}/registry-auth.crt`

interface KeyPair {
  privateKey: forge.pki.rsa.PrivateKey
  kid: string
}

let _cached: KeyPair | null = null

export function ensureKeyPair(): KeyPair {
  if (_cached) return _cached

  const KEY_PATH = keyPath(), CERT_PATH = certPath()
  if (!fs.existsSync(KEY_PATH)) {
    console.log('[registry-auth] generating RSA key pair...')
    const kp = forge.pki.rsa.generateKeyPair({ bits: 2048 })

    fs.mkdirSync(authDir(), { recursive: true })
    fs.writeFileSync(KEY_PATH, forge.pki.privateKeyToPem(kp.privateKey), { mode: 0o600 })

    const cert = forge.pki.createCertificate()
    cert.publicKey = kp.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10)
    const attrs = [{ name: 'commonName', value: 'p7y-registry-auth' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(kp.privateKey, forge.md.sha256.create())
    fs.writeFileSync(CERT_PATH, forge.pki.certificateToPem(cert))

    _cached = { privateKey: kp.privateKey, kid: computeKid(kp.publicKey) }
    console.log('[registry-auth] key pair ready')
  } else {
    const privateKey = forge.pki.privateKeyFromPem(fs.readFileSync(KEY_PATH, 'utf8'))
    const cert = forge.pki.certificateFromPem(fs.readFileSync(CERT_PATH, 'utf8'))
    _cached = { privateKey, kid: computeKid(cert.publicKey as forge.pki.rsa.PublicKey) }
  }

  return _cached
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// Initialize at module load so the cert file is ready before the registry container starts
try { ensureKeyPair() } catch (err) { console.error('[registry-auth] init error:', err) }
function base32Encode(buf: Buffer): string {
  let result = ''
  let bits = 0
  let value = 0
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      result += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) result += BASE32[(value << (5 - bits)) & 31]
  return result
}

function computeKid(publicKey: forge.pki.rsa.PublicKey): string {
  const der = forge.asn1.toDer(forge.pki.publicKeyToAsn1(publicKey))
  const hash = crypto.createHash('sha256').update(Buffer.from(der.getBytes(), 'binary')).digest()
  const encoded = base32Encode(hash.subarray(0, 30))
  return encoded.match(/.{1,4}/g)!.slice(0, 12).join(':')
}

/** A registry bearer token for `subject` granting exactly `access` (see grantFor), valid 5 minutes. */
export function issueToken(subject: string, service: string, access: RegistryAccess): string {
  const { privateKey, kid } = ensureKeyPair()
  const now = Math.floor(Date.now() / 1000)

  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'p7y',
    sub: subject,
    aud: service,
    exp: now + 300,
    nbf: now - 10,
    iat: now,
    jti: crypto.randomBytes(8).toString('hex'),
    access
  })).toString('base64url')

  const signingInput = `${header}.${payload}`
  const md = forge.md.sha256.create()
  md.update(signingInput, 'utf8')
  const sig = Buffer.from(privateKey.sign(md), 'binary').toString('base64url')

  return `${signingInput}.${sig}`
}

export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex')
    crypto.scrypt(password, salt, 32, (err, hash) => {
      if (err) reject(err)
      else resolve(`${salt}:${hash.toString('hex')}`)
    })
  })
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hashHex] = stored.split(':')
    crypto.scrypt(password, salt, 32, (err, derived) => {
      if (err) reject(err)
      else {
        try { resolve(crypto.timingSafeEqual(derived, Buffer.from(hashHex, 'hex'))) }
        catch { resolve(false) }
      }
    })
  })
}
