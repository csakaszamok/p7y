import fs from 'fs'
import forge from 'node-forge'

/** The certificate the TCP gateway serves: the copied-in one, or a self-signed *.<domain> kept in data/. */
export function tcpTlsCredentials(opts: { certDir?: string; dataDir?: string; domain?: string } = {}): { key: string; cert: string; source: 'certs' | 'generated' } {
  const certDir = opts.certDir ?? process.env.CERTS_DIR ?? '/app/certs'
  const dataDir = opts.dataDir ?? '/app/data'
  const domain = (opts.domain ?? process.env.HOST_DOMAIN ?? 'lvh.me').toLowerCase()
  if (fs.existsSync(`${certDir}/tls.crt`) && fs.existsSync(`${certDir}/tls.key`)) {
    return { cert: fs.readFileSync(`${certDir}/tls.crt`, 'utf8'), key: fs.readFileSync(`${certDir}/tls.key`, 'utf8'), source: 'certs' }
  }
  const certPath = `${dataDir}/tcp-tls.crt`, keyPath = `${dataDir}/tcp-tls.key`
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = Date.now().toString(16)
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 86400e3)
    const subject = [{ name: 'commonName', value: `*.${domain}` }]
    cert.setSubject(subject); cert.setIssuer(subject)
    cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: `*.${domain}` }, { type: 2, value: domain }] }])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(certPath, forge.pki.certificateToPem(cert))
    fs.writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 })
  }
  return { cert: fs.readFileSync(certPath, 'utf8'), key: fs.readFileSync(keyPath, 'utf8'), source: 'generated' }
}
