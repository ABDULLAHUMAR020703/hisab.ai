import 'server-only'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { chmod, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import type { ZatcaCsrResult, ZatcaCsrSubjectInput } from './types'
import { buildZatcaOpenSslConfig } from './csr-template'
import { buildCsrSubjectValues, csrPemToZatcaBase64 } from './csr-subject'

const OPENSSL_CANDIDATES =
  process.platform === 'win32'
    ? ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe']
    : ['openssl']

interface SpawnResult {
  code: number | null
  stdout: string
  stderr: string
}

function runCommand(command: string, args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch {
    // ignore missing temp files
  }
}

let opensslCommand: string | null | undefined

/**
 * Resolves a *working* OpenSSL binary by actually running `version` on each
 * candidate. ZATCA accepts OpenSSL-generated CSRs but rejects the node-forge
 * fallback, so it is critical we detect a real OpenSSL when one exists (e.g.
 * Git for Windows) instead of blindly trusting `openssl` being on PATH.
 */
async function resolveOpenSslCommand(): Promise<string | null> {
  if (opensslCommand !== undefined) return opensslCommand

  for (const candidate of OPENSSL_CANDIDATES) {
    if (candidate !== 'openssl' && !existsSync(candidate)) continue
    try {
      const result = await runCommand(candidate, ['version'])
      if (result.code === 0) {
        opensslCommand = candidate
        return candidate
      }
    } catch {
      // Candidate not runnable — try the next one.
    }
  }

  opensslCommand = null
  return null
}

export async function isOpenSslAvailable(): Promise<boolean> {
  return (await resolveOpenSslCommand()) !== null
}

/**
 * Generates a ZATCA CSR using the OpenSSL CLI (preferred — matches Fatoora validator expectations).
 */
export async function generateZatcaCsrWithOpenSsl(
  input: ZatcaCsrSubjectInput,
): Promise<ZatcaCsrResult> {
  const command = await resolveOpenSslCommand()
  if (!command) {
    throw new Error('OpenSSL is not available')
  }

  const subject = buildCsrSubjectValues(input)
  const privateKeyFile = join(tmpdir(), `hisab-zatca-${randomUUID()}.pem`)
  const configFile = join(tmpdir(), `hisab-zatca-${randomUUID()}.cnf`)
  const csrFile = join(tmpdir(), `hisab-zatca-${randomUUID()}.csr`)

  const config = buildZatcaOpenSslConfig({
    environment: input.environment,
    solutionName: subject.solutionName,
    egsModel: subject.egsModel,
    egsSerialNumber: subject.egsSerialNumber,
    vatNumber: subject.vat,
    organizationIdentifier: subject.organizationIdentifier,
    organizationName: subject.organizationName,
    organizationUnit: subject.organizationUnit,
    commonName: subject.commonName,
    registeredAddress: subject.registeredAddress,
    businessCategory: subject.businessCategory,
    invoiceTypes: subject.invoiceTypes,
  })

  try {
    const keyResult = await runCommand(command, [
      'ecparam',
      '-name',
      'secp256k1',
      '-genkey',
      '-noout',
      '-out',
      privateKeyFile,
    ])
    if (keyResult.code !== 0) {
      throw new Error(keyResult.stderr.trim() || 'OpenSSL key generation failed')
    }

    await chmod(privateKeyFile, 0o600)
    await writeFile(configFile, config, 'utf8')

    const csrResult = await runCommand(command, [
      'req',
      '-new',
      '-sha256',
      '-key',
      privateKeyFile,
      '-config',
      configFile,
      '-extensions',
      'v3_req',
      '-out',
      csrFile,
    ])
    if (csrResult.code !== 0) {
      throw new Error(csrResult.stderr.trim() || 'OpenSSL CSR generation failed')
    }

    const { readFile } = await import('fs/promises')
    const privateKeyPem = await readFile(privateKeyFile, 'utf8')
    const csrPem = await readFile(csrFile, 'utf8')

    return {
      csrPem: csrPem.trim(),
      csrBase64: csrPemToZatcaBase64(csrPem),
      privateKeyPem: privateKeyPem.trim(),
      commonName: subject.commonName,
    }
  } finally {
    await Promise.all([safeUnlink(privateKeyFile), safeUnlink(configFile), safeUnlink(csrFile)])
  }
}
