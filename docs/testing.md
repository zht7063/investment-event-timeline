# Testing

## Test Commands

```bash
# Unit and integration tests (no real API calls, uses in-memory SQLite)
npm test

# Type checking
npm run typecheck

# Production build (also runs TypeScript validation)
npm run build
```

## Test Results (2026-10-25)

| Category | File | Tests | Status |
| --- | --- | --- | --- |
| Unit | tests/unit/conclusion.test.ts | conclusion engine rules | Pass |
| Unit | tests/unit/matching.test.ts | dedup, candidate scoring | Pass |
| Unit | tests/unit/time.test.ts | time parsing and formatting | Pass |
| Unit | tests/unit/ai.test.ts | extraction validation, quote check, model JSON parsing | Pass |
| Unit | tests/unit/http.test.ts | retry policy (429, 5xx, timeout, 400/401/403) | Pass |
| Integration | tests/integration/seed.test.ts | seed data loads, conclusion history replays correctly | Pass |
| Integration | tests/integration/ingest.test.ts | import, dedup, analyze, associate, revoke, recompute | Pass |
| Build | `npm run build` | 17 routes registered, 0 errors | Pass |
| Typecheck | `npm run typecheck` | 0 errors | Pass |

Total: 7 test files, 47 tests, all passing.

## What Tests Cover

- Four claim categories (fact, opinion, speculation, rumor) with correct weights
- Same-URL new version vs duplicate (content hash)
- Repeat import is idempotent (no duplicate claims)
- Repost chains do not increase weight
- Support, conflict, denial, correction, supersede, expiry conclusion transitions
- Revoke evidence and recompute
- As-of view excludes future evidence
- Same company, different matter does not merge
- Verbatim quote validation (model output with fabricated quote is rejected)
- Invalid category, date, or JSON from model is rejected gracefully
- 429 retry with Retry-After, 5xx backoff, 400/401/403 no-retry
- Timeout handling
- Seed data conclusion history matches expected 8 versions

## What Tests Do Not Cover (Known Gaps)

- No Playwright e2e tests yet (planned but not created in 3-hour window)
- No real model or provider smoke tests in the automated suite (manual verification done, not repeatable without API keys)
- "Unit and basis must not be mixed" edge case has no dedicated test (mentioned in plan section 9)
- No load or stress testing
- No accessibility automated testing (WCAG compliance requires manual testing with assistive technologies)

## Manual Verification Done

1. Browser: import -> real model extraction (3 claims) -> candidate auto-select by matter key -> associate 2 claims -> conclusion change -> revoke -> revert
2. Conclusion history: 10 versions after real import on top of seed data
3. Event list: search, status filter, watchlist filter all work
4. As-of view: historical conclusions exclude future evidence
5. Sources page: 3 live sources (iFinD notice, iFinD news, Fuyao news) + 6 constructed
6. API health check: 200 with db ok
7. Production build: all 17 routes, no errors
