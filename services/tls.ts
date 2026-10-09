// services/tls.ts
import forge from 'node-forge'

export interface CertBundle {
  caCert: string
  caKey: string
  serverCert: string
  serverKey: string
  clientCert: string
  clientKey: string
}

export function generateCertBundle(hostAddress: string, containerName?: string, keySize = 2048, extraDnsNames: string[] = []): CertBundle {
  const now = new Date()
  const expiry = new Date(now)
  expiry.setFullYear(now.getFullYear() + 10)

  function buildCert(
    keys: forge.pki.KeyPair,
    subject: forge.pki.CertificateField[],
    issuer: forge.pki.CertificateField[],
    signingKey: forge.pki.rsa.PrivateKey,
    serial: string,
    extensions: object[]
  ): forge.pki.Certificate {
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = serial
    cert.validity.notBefore = now
    cert.validity.notAfter = expiry
    cert.setSubject(subject)
    cert.setIssuer(issuer)
    cert.setExtensions(extensions)
    cert.sign(signingKey, forge.md.sha256.create())
    return cert
  }

  const caKeys = forge.pki.rsa.generateKeyPair(keySize)
  const caAttrs = [{ name: 'commonName', value: 'Purgatory CA' }]
  const caCert = buildCert(caKeys, caAttrs, caAttrs, caKeys.privateKey, '01', [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true }
  ])

  const serverKeys = forge.pki.rsa.generateKeyPair(keySize)
  const serverCert = buildCert(
    serverKeys,
    [{ name: 'commonName', value: hostAddress }],
    caAttrs,
    caKeys.privateKey,
    '02',
    [
      { name: 'basicConstraints', cA: false },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [
        /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/.test(hostAddress)
          ? { type: 7, ip: hostAddress }   // IP SAN
          : { type: 2, value: hostAddress }, // DNS SAN
        { type: 2, value: 'host.docker.internal' },
        { type: 7, ip: '127.0.0.1' },
        ...(containerName ? [{ type: 2, value: containerName }] : []),
        ...extraDnsNames.map(value => ({ type: 2, value })) // e.g. <raw>-docker.<domain>, where the Docker CLI connects
      ] }
    ]
  )

  const clientKeys = forge.pki.rsa.generateKeyPair(keySize)
  const clientCert = buildCert(
    clientKeys,
    [{ name: 'commonName', value: 'p7y-client' }],
    caAttrs,
    caKeys.privateKey,
    '03',
    [
      { name: 'basicConstraints', cA: false },
      { name: 'extKeyUsage', clientAuth: true }
    ]
  )

  return {
    caCert: forge.pki.certificateToPem(caCert),
    caKey: forge.pki.privateKeyToPem(caKeys.privateKey),
    serverCert: forge.pki.certificateToPem(serverCert),
    serverKey: forge.pki.privateKeyToPem(serverKeys.privateKey),
    clientCert: forge.pki.certificateToPem(clientCert),
    clientKey: forge.pki.privateKeyToPem(clientKeys.privateKey)
  }
}
