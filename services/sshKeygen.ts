import crypto from 'node:crypto'

const str = (b: Buffer | string): Buffer => {
  const v = typeof b === 'string' ? Buffer.from(b) : b
  const len = Buffer.alloc(4)
  len.writeUInt32BE(v.length)
  return Buffer.concat([len, v])
}
const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }

/** An ed25519 key pair in the formats OpenSSH reads: `ssh-ed25519 …` and an unencrypted openssh-key-v1 file. */
export function generateSshKeyPair(comment = 'p7y-generated'): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url')
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d as string, 'base64url')
  const pubBlob = Buffer.concat([str('ssh-ed25519'), str(pub)])
  const check = crypto.randomBytes(4).readUInt32BE(0)
  let priv = Buffer.concat([u32(check), u32(check), str('ssh-ed25519'), str(pub), str(Buffer.concat([seed, pub])), str(comment)])
  const pad = (8 - (priv.length % 8)) % 8
  priv = Buffer.concat([priv, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))])
  const body = Buffer.concat([Buffer.from('openssh-key-v1\0', 'latin1'), str('none'), str('none'), str(''), u32(1), str(pubBlob), str(priv)])
  const lines = body.toString('base64').match(/.{1,70}/g) ?? []
  return {
    publicKey: `ssh-ed25519 ${pubBlob.toString('base64')} ${comment}`,
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`,
  }
}
