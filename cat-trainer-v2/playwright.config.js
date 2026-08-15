import { defineConfig, devices } from '@playwright/test';

// Acceptance harness config. Two things here are load-bearing and should not be
// "optimized" without thinking them through:
//
//   1. workers: 1 / fullyParallel: false — every test drives the SAME QA family
//      in a live Firebase project. Parallel tests would interleave writes and
//      assert on each other's state.
//   2. trace / screenshot / video all OFF — this repo is public and CI artifacts
//      on a public repo are downloadable by anyone. A Playwright trace records
//      action arguments (including the password typed into the sign-in field),
//      network bodies, and DOM snapshots (including the Family ID). The suite
//      takes its own REDACTED screenshot on failure instead; see
//      tools/acceptance.mjs.
export default defineConfig({
  testDir: './tools',
  testMatch: 'acceptance.mjs',

  fullyParallel: false,
  workers: 1,
  // No retries: these tests mutate shared state, so a second attempt would run
  // against whatever the first attempt left behind and report a misleading pass.
  retries: 0,
  // Firestore round trips over a real network; generous but not unbounded.
  timeout: 90_000,
  expect: { timeout: 20_000 },

  // `list` for humans, `github` for inline annotations on the Actions run. No
  // HTML report: it bundles attachments and we are deliberately strict about
  // what leaves this job.
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],

  outputDir: 'test-results',

  use: {
    baseURL: process.env.APP_URL || 'https://xiateas-source.github.io/School/cat-trainer-v2/',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    ...devices['Desktop Chrome']
  },

  projects: [{ name: 'chromium' }]
});
