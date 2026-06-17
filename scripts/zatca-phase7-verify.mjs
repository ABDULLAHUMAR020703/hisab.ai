/**
 * Phase 7 offline verification (XML compliance, failure scenarios, mock E2E).
 * Real ZATCA sandbox calls require OTP and ZATCA_MOCK_* unset — see docs/ZATCA_PHASE7_REAL_SANDBOX.md
 *
 * Usage:
 *   DATABASE_URL="file:./dev.db" npx tsx -r ./scripts/setup-server-only.cjs scripts/zatca-phase7-verify.mjs
 */
process.env.ZATCA_MOCK_SUBMISSION = process.env.ZATCA_MOCK_SUBMISSION ?? 'true'
process.env.ZATCA_MOCK_ONBOARDING = process.env.ZATCA_MOCK_ONBOARDING ?? 'true'

const { runFailureScenarios } = await import('../src/lib/zatca/testing/failure-scenarios.ts')
const { runAllSandboxScenarios } = await import('../src/lib/zatca/testing/sandbox-runner.ts')
const { getZatcaApiBaseUrl } = await import('../src/lib/zatca/api/client.ts')

console.log('\n=== Phase 7 ZATCA Verification ===\n')
console.log('API base:', getZatcaApiBaseUrl())
console.log('Mock onboarding:', process.env.ZATCA_MOCK_ONBOARDING)
console.log('Mock submission:', process.env.ZATCA_MOCK_SUBMISSION)
console.log('')

console.log('--- Failure scenario tests ---')
const failures = runFailureScenarios()
for (const r of failures) {
  console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.scenario}: ${r.messages[0] ?? 'no message'}`)
}
const failOk = failures.every((r) => r.passed)
console.log(`Failure handling: ${failOk ? 'PASS' : 'FAIL'}\n`)

console.log('--- Mock E2E sandbox scenarios ---')
const sandbox = await runAllSandboxScenarios()
for (const r of sandbox) {
  console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.scenario} → ${r.actualStatus ?? 'n/a'}`)
}
const sandboxOk = sandbox.every((r) => r.passed)
console.log(`Sandbox E2E: ${sandboxOk ? 'PASS' : 'FAIL'}\n`)

if (process.env.ZATCA_MOCK_ONBOARDING !== 'true') {
  console.log('Real sandbox mode: run onboarding via UI or API with Fatoora OTP')
  console.log('  POST /api/zatca/onboarding/csr')
  console.log('  POST /api/zatca/onboarding/compliance { "otp": "..." }')
  console.log('  Submit 6 compliance invoices via /compliance/invoices')
  console.log('  POST /api/zatca/onboarding/production')
  console.log('  POST /api/zatca/invoices/[id]/submit per invoice type')
}

process.exit(failOk && sandboxOk ? 0 : 1)
