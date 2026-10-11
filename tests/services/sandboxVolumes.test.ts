import { describe, it, expect } from 'vitest'
import { volumeRows } from '../../services/sandboxVolumes'

describe('volumeRows', () => {
  const volumes: Parameters<typeof volumeRows>[0] = [
    { Name: 'shop_uploads', Driver: 'local', Labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.volume': 'uploads' } },
    { Name: 'shop_db', Driver: 'local', Labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.volume': 'db' } },
    { Name: '3f9a0c', Driver: 'local', Labels: null },
    { Name: 'nfs_share', Driver: 'nfs', Labels: {} },
  ]
  const containers: Parameters<typeof volumeRows>[1] = [
    { Names: ['/shop-db-1'], State: 'running', Labels: { 'com.docker.compose.service': 'db' }, Mounts: [{ Type: 'volume', Name: 'shop_db', Destination: '/var/lib/postgresql/data' }] },
    { Names: ['/shop-web-1'], State: 'exited', Labels: {}, Mounts: [{ Type: 'volume', Name: 'shop_uploads', Destination: '/app/uploads' }, { Type: 'bind', Source: '/srv', Destination: '/srv' }] },
  ]

  it('local volumes with their folder, compose project and the containers that use them, by project and name', () => {
    expect(volumeRows(volumes, containers)).toEqual([
      { name: '3f9a0c', path: '/var/lib/docker/volumes/3f9a0c/_data', project: null, containers: [] },
      { name: 'shop_db', path: '/var/lib/docker/volumes/shop_db/_data', project: 'shop', containers: [{ name: 'shop-db-1', service: 'db', running: true, mount: '/var/lib/postgresql/data' }] },
      { name: 'shop_uploads', path: '/var/lib/docker/volumes/shop_uploads/_data', project: 'shop', containers: [{ name: 'shop-web-1', service: null, running: false, mount: '/app/uploads' }] },
    ])
  })
  it('leaves out a volume another driver keeps (its files are not in the sandbox), and a name the paths refuse', () => {
    const names = volumeRows([...volumes, { Name: '-odd', Driver: 'local', Labels: {} }], []).map(v => v.name)
    expect(names).not.toContain('nfs_share')
    expect(names).not.toContain('-odd')
  })
})
