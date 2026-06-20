import { generateKeyPairSync } from 'crypto'

/**
 * Generates an ECDSA secp256k1 private key for ZATCA CSR signing.
 * ZATCA Phase 2 mandates secp256k1 (not RSA) for Fatoora onboarding CSRs.
 */
export function generatePrivateKey(): string {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return privateKey
}
