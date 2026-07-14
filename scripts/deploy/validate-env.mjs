#!/usr/bin/env node
/**
 * Validates required production environment variables.
 * Usage: node scripts/deploy/validate-env.mjs
 */
const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

const recommended = [
  'ZATCA_CREDENTIAL_ENCRYPTION_KEY',
  'CRON_SECRET',
  'NODE_ENV',
]

let failed = false

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[FAIL] Missing required env: ${key}`)
    failed = true
  } else {
    console.log(`[OK] ${key}`)
  }
}

for (const key of recommended) {
  if (!process.env[key]) {
    console.warn(`[WARN] Missing recommended env: ${key}`)
  } else {
    console.log(`[OK] ${key}`)
  }
}

if (process.env.NODE_ENV === 'production' && !process.env.ZATCA_CREDENTIAL_ENCRYPTION_KEY) {
  console.error('[FAIL] ZATCA_CREDENTIAL_ENCRYPTION_KEY required in production')
  failed = true
}

if (failed) process.exit(1)
console.log('Environment validation passed.')
