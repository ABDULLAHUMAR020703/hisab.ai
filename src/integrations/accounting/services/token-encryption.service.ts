import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const VERSION = 'v1'

export class TokenEncryptionService {
  private readonly key: Buffer

  constructor(secret: string) {
    if (secret.length < 16) throw new Error('Integration token encryption secret must be at least 16 characters.')
    this.key = createHash('sha256').update(secret).digest()
  }

  encrypt(token: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
  }

  decrypt(payload: string): string {
    const [version, ivValue, tagValue, encryptedValue] = payload.split('.')
    if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) throw new Error('Invalid encrypted token payload.')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }
}
