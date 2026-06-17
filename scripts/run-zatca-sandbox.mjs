/**
 * Run ZATCA sandbox E2E scenarios (mock mode).
 * Usage: node --import ./scripts/mock-server-only-hook.mjs scripts/run-zatca-sandbox.mjs
 */
process.env.ZATCA_MOCK_SUBMISSION = 'true'
process.env.ZATCA_MOCK_ONBOARDING = 'true'

const { runAllSandboxScenarios } = await import('../src/lib/zatca/testing/sandbox-runner.ts')

const results = await runAllSandboxScenarios()
const passed = results.filter((r) => r.passed).length

console.log(`\nZATCA Sandbox: ${passed}/${results.length} passed\n`)
for (const r of results) {
  console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.scenario} (${r.durationMs}ms) → expected ${r.expectedStatus}, actual ${r.actualStatus ?? 'n/a'}`)
  for (const step of r.steps) {
    console.log(`  ${step.passed ? 'ok' : '!!'} ${step.step}${step.detail ? `: ${step.detail}` : ''}`)
  }
  if (r.error) console.log(`  error: ${r.error}`)
}

process.exit(passed === results.length ? 0 : 1)
