# Aurevia Exchange defect report

**Inspection date:** 2026-11-21  
**Repository:** `aurevia3/Aurevia`, branch `main`  
**Scope:** Read-only baseline and focused inspection before further implementation.  
**Production safety:** No production website, database, secrets, or deployment configuration was accessed or changed.

## Repository and deployment identification

The current checkout is the `aurevia3/Aurevia` Git repository, on `main`, tracking `origin/main`. The current working directory is `/workspaces/Aurevia/Aurevia/aurevia`. The repository remote alone does not establish that this is the exact checkout currently deployed to `https://aurevia-et63.onrender.com`; the README says deployment-provider configuration is not checked in. Render service linkage, deployed commit, production secrets, database endpoint, and provider entitlements remain unverified.

The working tree was not clean at inspection start: `tests/e2e/application.spec.ts` contained a pre-existing, uncommitted change from the previous task. That change is preserved and is not included as a repair made during this inspection.

## Confirmed findings

| ID | Severity | Finding and evidence | Impact / disposition |
|---|---|---|---|
| D-01 | Medium | `tests/profile-two-factor.test.ts` expected `twoFactorAvailable: false` while `lib/security.ts` reports availability when a valid server-side `TOTP_ENCRYPTION_KEY` is configured. The test intended to simulate a legacy enabled flag without an encrypted secret but did not isolate its environment. | Fixed in test: explicitly simulate an unavailable encryption key. The API behavior was preserved. |
| D-02 | High | Password sign-in in `lib/auth-options.ts` originally verified the password and created a session without checking `twoFactorEnabled` or consuming a second factor. `consumeSecondFactor` had no production caller, and the security-center copy said authenticator setup did not change password-only sign-in. | Fixed: password login now requires and atomically consumes a TOTP/recovery code for enrolled accounts. Login forms and security-center copy were updated. TOTP replay testing uncovered D-04 below; the complete MFA flow passed its isolated browser test after that fix. |
| D-03 | Medium | The earlier browser suite contained assertions that conflicted with the documented internal simulated REAL execution model (for example, expecting funded REAL orders to be rejected solely because external brokerage was disabled). It also expected an obsolete oversell error string. | The previous task updated those assertions in `tests/e2e/application.spec.ts`; focused tests subsequently passed. They remain uncommitted user-visible work and must be preserved. |
| D-04 | High | `lib/security.ts` calculated the replay counter as `Math.floor(Date.now()/TOTP_PERIOD_SECONDS)`. `Date.now()` is milliseconds while the TOTP period is seconds, so the counter advanced about every 30 ms instead of every 30 seconds. A browser test reproduced successful reuse of the same accepted code. | Fixed by calculating the counter in 30-second steps. A deterministic unit regression verifies the same code has the same counter after 31 ms, and the isolated browser test verifies replay rejection and one-time recovery-code use. |

## Phase 1 — market-data and execution-path audit

The following are confirmed from the inspected provider, service, route, admin, and test code. This is a focused audit, not a claim that every route or UI page has been reviewed.

| ID | Severity | Finding and evidence | Impact / disposition |
|---|---|---|---|
| D-05 | High | Twelve Data was not primary: Financial Modeling Prep was prioritized, and `lib/live-market.ts` routed stock and crypto markets through Alpaca/Finnhub. | Repaired: Twelve Data is now the sole external market-data provider for supported quotes/history/search/indicators/market-state requests. No provider fallback runs after a failure. Unit tests verify Twelve Data-only selection and clear unavailable behavior. Production entitlements are unverified. |
| D-06 | High | Market-data outage handling could return generated market values from internal reference prices and generated OHLC candles. | Repaired for provider-backed routes: quotes/history now report unavailable/stale data instead of substituting synthetic market data. The internal simulation remains available only for DEMO/internal trading flows. |
| D-07 | High | Alpaca API traffic for historical paper orders was reachable from customer cancellation and admin sync/status paths. | Repaired: removed the Alpaca client modules and remote order-sync endpoint; new REAL orders continue through Aurevia's internal simulated service. Historical order/provider fields are retained only to guard existing records and are not used to make provider requests. |
| D-08 | Medium | The prior Twelve Data adapter exposed credentials in query parameters, hardcoded its host, accepted ambiguous/missing timestamps, and lacked search/indicator support. | Repaired: credentials use the documented server-side authorization header; base URL is server-configured and restricted to the official HTTPS host; missing, offset-ambiguous, and future quote timestamps are rejected; future candles are rejected; documented search/indicator/market-state endpoints are wired. |
| D-09 | Medium | Admin provider health exposed retired provider fields instead of Twelve Data diagnostics. | Repaired: status includes Twelve Data authentication/connection, last successful request/data, freshness, capabilities, rate-limit counts, sanitized errors, and historical-candle availability. Status and UI are covered by build/type checking; live account behavior is not verified. |

### Official Twelve Data documentation checked

- [Authentication and API credits](https://twelvedata.com/docs/introduction/quickstart): supports the `Authorization: apikey <key>` request header; API credits are counted per minute, and the Basic plan has an 800-credit daily cap. The `/api_usage` endpoint reports the account's plan limits and usage.
- [Time series](https://twelvedata.com/docs/market-data/time-series): `GET /time_series`; supported intervals include `1min`, `5min`, `15min`, `30min`, `1h`, `2h`, `4h`, `8h`, `1day`, `1week`, and `1month`; response values contain OHLCV and local-exchange `datetime`, with `meta.exchange_timezone`. Maximum `outputsize` is 5,000; documented cost is one credit per symbol. Pre/post-market data has higher-plan restrictions.
- [Symbol search](https://twelvedata.com/docs/discovery/symbol-search): `GET /symbol_search`; `symbol` is required; `outputsize` max is 120; documented cost is one credit per request.
- [Markets](https://twelvedata.com/docs/markets/market-state) and [technical indicator catalog](https://twelvedata.com/docs): market state and supported indicator endpoints exist, but actual symbol access, real-time exchange entitlements, indicator availability, and request quotas depend on the Twelve Data account plan/add-ons and have not been verified against production credentials.
- [Error responses](https://twelvedata.com/docs/introduction/errors): responses use `code`, `message`, and `status`; documented conditions include invalid key (401), insufficient plan permissions (403), unavailable data (404), and request limits (429).

### Audit boundaries

- No production URL, Render configuration, live credentials, or production database was accessed. The provided production URL is only a target identifier; the Render service's deployed commit and repository linkage have not been verified.
- After explicit confirmation that the ignored local `.env` was non-production, removed retired Alpaca, Finnhub, Alpha Vantage, Financial Modeling Prep, QVeris, Twelve Data WebSocket, and generic broker variable lines without displaying their values. No production environment settings were changed.
- No migration or database operation was performed. Existing schema/migration names containing Alpaca are historical records and are not to be deleted or rewritten as part of removing runtime calls.
- REAL internal wallet trading is implemented in `lib/orders.ts`; the focused inspection confirms it is not routed through Alpaca for new orders. This does not constitute a complete financial-system audit of every funding, withdrawal, investment, or admin transaction path.
- The checkout had pre-existing uncommitted changes in authentication, security, and E2E files (see the initial Git status); those changes are outside the market-data repair and are preserved.
- E2E was not rerun for this provider replacement. The isolated runner invokes container tooling, but the environment's required container-configuration tool was unavailable; no non-isolated E2E command was used against potentially production-configured `.env` settings.

## Validation and repair update

- TypeScript check: passed after the final market-data edits.
- ESLint: passed with one existing `<img>` optimization warning in `components/PwaInstallPrompt.tsx`.
- Production build: passed after the final market-data edits.
- Full unit suite after making Twelve Data exclusive: 844 passed across 165 test files.
- Focused Twelve Data, route, and configuration tests: 69 passed across 11 files.
- Focused TOTP/auth/profile unit tests: 39 passed.
- TOTP MFA isolated browser E2E: passed, including wrong-factor rejection, successful TOTP sign-in, same-code replay rejection, single-use recovery code, and disable flow.
- Six isolated financial E2E tests passed: REAL internal trading, DEMO buy/sell, DEMO order idempotency, investment initiation, REAL withdrawal reservation/settlement, and deposit approval workflow.
- Historical E2E evidence from prior work: the isolated suite reported 373 passed and 14 failed out of 387; focused post-fix checks passed for login inputs, 320px/1920px admin views, and TOTP enrollment/sign-in/replay/recovery/disable. These checks predate the current market-data edits and do not validate them.
- Historical focused financial E2E evidence from prior work: six scenarios passed (REAL internal trading, DEMO buy/sell, DEMO order idempotency, investment initiation, REAL withdrawal reservation/settlement, and deposit approval workflow). They were not rerun here.
- The security-review agent reported no vulnerabilities in its reviewed changes; a full independent security audit of every route and integration is not evidenced here.
- Production behavior, provider credentials/entitlements, Render configuration, and live market freshness: not tested.

## Production-readiness assessment

| Area | Status | Evidence / limitation |
|---|---|---|
| Repository baseline and production linkage | PARTIAL | Checkout and branch identified; actual Render service/deployed commit linkage remains unverified. |
| Trading engine | PARTIAL | Focused REAL internal buy/sell and DEMO buy/sell/idempotency tests pass; all order types, partial fills, race behavior, and P&L reconciliations were not exhaustively audited. |
| Wallet and ledger | PARTIAL | Deposit approval and withdrawal reserve/settlement tests pass; every rejection, cancellation, payout reversal, fee, and multi-currency edge case was not covered. |
| Investments | PARTIAL | Investment reservation/scheduled activation and idempotency paths have focused coverage; every maturity, payout, cancellation, and boundary rule was not tested. |
| Market data | PARTIAL | Twelve Data adapters/routes and failure/timestamp behavior passed mocked tests; no live provider credentials, licensing/plan entitlements, or production freshness was verified. QVeris was not integrated. |
| Order book and charts | PARTIAL | Existing provider-backed chart and order-book coverage exists in the suite; live production data quality was not verified. |
| Authentication and MFA | PARTIAL | Password MFA/recovery consumption and TOTP replay fix are covered by unit and isolated browser tests; full independent audit of auth providers and all session flows remains outstanding. |
| Security | PARTIAL | A security-review agent reported no vulnerabilities in its reviewed changes; this is not a full route-by-route production security certification. |
| Administrator operations | PARTIAL | Admin authorization, investment, deposit, and responsive route tests were exercised; every admin mutation/duplicate-financial-operation path was not audited. |
| Email/SMS | NOT TESTED | E2E environment logged email as unconfigured; provider delivery and SMS confirmation were not exercised. |
| User-interface responsiveness | PARTIAL | Full browser suite exercised many public/mobile widths; admin 320px and 1920px route checks pass post-fix, but all viewports were not rerun post-fix. |
| Performance and stability | PARTIAL | Wallet E2E recorded initial authoritative balance at 707 ms with 14 requests; no broad profiling/load or production latency test was performed. |
| TypeScript, unit tests, lint, build | PASS | Final typecheck, 844 unit tests, lint (one existing warning), and optimized production build passed. |
| Database/migration safety | PASS | No schema/migration edits or production operations were performed in this phase. |
| E2E validation | BLOCKED | Not run for these edits because the required container CLI configuration tool was unavailable; did not run against non-isolated environment variables. |
| Production readiness | BLOCKED | No deployment approval or production changes; provider entitlements, Render linkage/configuration, production data behavior, and relevant E2E remain unverified. |

## Scope and next actions

1. Run isolated E2E after valid container configuration is available.
2. Verify Twelve Data account authentication, licensing, symbol coverage, realtime/delayed entitlements, and request quotas only with explicitly configured integration credentials.
3. Keep the broader financial, notification, admin, accessibility/responsiveness, performance, and production audits marked PARTIAL/NOT TESTED where evidence is absent.
4. Do not apply production migrations, alter production configuration/data, push, commit, or deploy without explicit approval.

No database migration has been identified as necessary for the findings above; the existing schema already contains the TOTP secret, replay counter, enrollment, recovery-code, and security-session records. Any future schema requirement must be reviewed separately.
