import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import forge from 'node-forge'
import { tcpTlsCredentials } from '../../services/tcpCert'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-tcpcert-'))

describe('tcpTlsCredentials', () => {
  it('uses the copied-in certificate when there is one', () => {
    const certDir = tmp(), dataDir = tmp()
    fs.writeFileSync(`${certDir}/tls.crt`, 'CERT'); fs.writeFileSync(`${certDir}/tls.key`, 'KEY')
    expect(tcpTlsCredentials({ certDir, dataDir, domain: 'lvh.me' })).toEqual({ cert: 'CERT', key: 'KEY', source: 'certs' })
  })

  it('otherwise generates a self-signed *.<domain> once and reuses it', () => {
    const certDir = tmp(), dataDir = tmp()
    const a = tcpTlsCredentials({ certDir, dataDir, domain: 'lvh.me' })
    expect(a.source).toBe('generated')
    const sans = (forge.pki.certificateFromPem(a.cert).getExtension('subjectAltName') as { altNames: Array<{ value: string }> }).altNames.map(n => n.value)
    expect(sans).toEqual(['*.lvh.me', 'lvh.me'])
    expect(tcpTlsCredentials({ certDir, dataDir, domain: 'lvh.me' }).cert).toBe(a.cert)
  })
})
