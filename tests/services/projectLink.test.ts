import { describe, it, expect } from 'vitest'
import { issueProjectLink, takeProjectLink, projectDirFiles } from '../../services/projectLink'
import { generateCertBundle } from '../../services/tls'

const T = 1_000_000
const good = generateCertBundle('127.0.0.1', 'p7y-shop', 1024, ['shop-docker.example.com'])
const other = generateCertBundle('127.0.0.1', 'p7y-x', 1024)

describe('the project folder link', () => {
  it('works once, for 5 minutes from when it was made', () => {
    const a = issueProjectLink('p7y-shop', T)
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(takeProjectLink(a, T + 299_000)).toEqual({ sandbox: 'p7y-shop', withToken: null })
    expect(takeProjectLink(a, T + 299_500)).toBeNull() // used
    const b = issueProjectLink('p7y-shop', T)
    expect(takeProjectLink(b, T + 300_001)).toBeNull() // expired
    expect(takeProjectLink('nope', T)).toBeNull()
  })

  it('the .p7y folder: its files, the key checked against the certificate and the CA first', () => {
    const files = projectDirFiles({ name: 'p7y-shop', ca_cert: good.caCert, client_cert: good.clientCert, client_key: good.clientKey, docker_host: 'shop-docker.example.com' }, 'https://p7y.example.com')
    expect(Object.fromEntries(files.map(f => [f.name, f.data]))).toEqual({
      '.p7y/.gitignore': '*\n',
      '.p7y/p7y.env': 'P7Y_URL=https://p7y.example.com\nP7Y_SANDBOX=p7y-shop\nP7Y_DOCKER_HOST=tcp://shop-docker.example.com:443\n',
      '.p7y/docker/ca.pem': good.caCert,
      '.p7y/docker/cert.pem': good.clientCert,
      '.p7y/docker/key.pem': good.clientKey,
    })
    expect(files.find(f => f.name === '.p7y/docker/key.pem')!.mode).toBe(0o600)
    expect(() => projectDirFiles({ name: 'p7y-shop', ca_cert: good.caCert, client_cert: good.clientCert, client_key: other.clientKey, docker_host: 'x' }, 'https://p7y.example.com')).toThrow(/does not match/)
  })
})
