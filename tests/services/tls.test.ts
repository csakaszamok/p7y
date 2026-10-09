import { describe, it, expect } from 'vitest'
import { generateCertBundle } from '../../services/tls'

describe('generateCertBundle', () => {
  it('returns all six PEM fields', () => {
    // 512-bit keys for test speed — use default 2048 in production
    const bundle = generateCertBundle('127.0.0.1', undefined, 512)
    expect(bundle.caCert).toMatch(/BEGIN CERTIFICATE/)
    expect(bundle.caKey).toMatch(/BEGIN.*PRIVATE KEY/)
    expect(bundle.serverCert).toMatch(/BEGIN CERTIFICATE/)
    expect(bundle.serverKey).toMatch(/BEGIN.*PRIVATE KEY/)
    expect(bundle.clientCert).toMatch(/BEGIN CERTIFICATE/)
    expect(bundle.clientKey).toMatch(/BEGIN.*PRIVATE KEY/)
  }, 30000)
})
