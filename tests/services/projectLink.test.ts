import { describe, it, expect } from 'vitest'
import { issueProjectLink, takeProjectLink, projectDirFiles } from '../../services/projectLink'
import { generateCertBundle } from '../../services/tls'

const T = 1_000_000
const good = generateCertBundle('127.0.0.1', 'p9m-shop', 1024, ['shop-docker.example.com'])
const other = generateCertBundle('127.0.0.1', 'p9m-x', 1024)

describe('the project folder link', () => {
  it('works once, for 5 minutes from when it was made', () => {
    const a = issueProjectLink('p9m-shop', T)
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(takeProjectLink(a, T + 299_000)).toEqual({ sandbox: 'p9m-shop', withToken: null })
    expect(takeProjectLink(a, T + 299_500)).toBeNull() // used
    const b = issueProjectLink('p9m-shop', T)
    expect(takeProjectLink(b, T + 300_001)).toBeNull() // expired
    expect(takeProjectLink('nope', T)).toBeNull()
  })

  it('the .p9m folder: its files, the key checked against the certificate and the CA first', () => {
    const files = projectDirFiles({ name: 'p9m-shop', ca_cert: good.caCert, client_cert: good.clientCert, client_key: good.clientKey, docker_host: 'shop-docker.example.com' }, 'https://p9m.example.com')
    expect(Object.fromEntries(files.map(f => [f.name, f.data]))).toEqual({
      '.p9m/.gitignore': '*\n',
      '.p9m/p9m.env': 'P9M_URL=https://p9m.example.com\nP9M_SANDBOX=p9m-shop\nP9M_DOCKER_HOST=tcp://shop-docker.example.com:443\n',
      '.p9m/docker/ca.pem': good.caCert,
      '.p9m/docker/cert.pem': good.clientCert,
      '.p9m/docker/key.pem': good.clientKey,
    })
    expect(files.find(f => f.name === '.p9m/docker/key.pem')!.mode).toBe(0o600)
    expect(() => projectDirFiles({ name: 'p9m-shop', ca_cert: good.caCert, client_cert: good.clientCert, client_key: other.clientKey, docker_host: 'x' }, 'https://p9m.example.com')).toThrow(/does not match/)
  })
})
