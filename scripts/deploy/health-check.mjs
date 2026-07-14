#!/usr/bin/env node
/**
 * Post-deploy health verification.
 * Usage: BASE_URL=https://app.example.com node scripts/deploy/health-check.mjs
 */
const base = process.env.BASE_URL ?? 'http://localhost:3000'

async function check(path, expectStatus = 200) {
  const res = await fetch(`${base}${path}`)
  const body = await res.json().catch(() => ({}))
  const ok = res.status === expectStatus
  console.log(`${ok ? 'OK' : 'FAIL'} ${path} -> ${res.status}`, body.status ?? '')
  if (!ok) process.exitCode = 1
  return body
}

await check('/api/live')
await check('/api/ready')
await check('/api/health')
