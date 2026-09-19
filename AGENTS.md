# AutoPost

## Purpose and boundaries
- A local-only Next.js photography curation studio. Manual import, carousel composition, and export must work without AI credentials.
- Never edit, rename, move, delete, or add sidecars to a user's source-photo folders. Import only through explicit user selection; the app makes checksum-verified copies in `data/assets/`.
- Never commit photographs, generated derivatives, SQLite files, API keys, or environment files. Never submit real photographs to an AI provider or incur API charges without explicit user consent.
- Keep the server bound to `127.0.0.1`. Do not remove the host/origin guard or expose this unauthenticated app on the network.
- The local SQLite database and source copies are user data, not disposable build artifacts. Do not reset or delete them to fix bugs.

## Setup and execution
- Verified with Node 22.17.1 and npm 11.7.0. Install dependencies with `npm ci`.
- `npm run dev` serves the app at `http://127.0.0.1:3000`. Use this direct address, not the Devin browser-preview proxy: the proxy changes the browser origin without preserving the corresponding Host, so mutations are correctly rejected by the strict guard.
- Configure optional `ANTHROPIC_API_KEY` in an ignored `.env` or `.env.local` file. Use a workspace-scoped key for the workspace containing API credit. An unscoped key is rejected by Anthropic unless requests explicitly provide a workspace header; the current setup uses the scoped-key approach. Restart Next after changing environment values. Never print or inspect secret values in task output.
- `POST /api/settings/check` with same-origin headers and `{ "consent": true }` performs only a fixed-text token-count connectivity check, with no photographs or generation. Run it only with user permission. Provider details are sanitized; normal image/curation errors never expose raw provider text.
- `AUTOPOST_AI_LIMIT_USD` sets the persistent local app allowance, default $1. The server also caps each multi-request curation run at $0.50. This is not the provider account balance. Uncertain failed requests conservatively retain their spending reservation. Preflight failures create no reservation; definite provider rejections release only that request’s reservation, without changing historical uncertain charges.
- AI uses Claude Haiku 4.5; changing the model also requires reviewing pricing, schema support, and cache versioning.
- `npm run build` then `npm start` builds and runs production locally. To build without disturbing an active development server, use `AUTOPOST_BUILD_DIR=.next-build npm run build`; use the same environment variable with `npm start` for that build.

## Verification
- `npm run typecheck`
- `npm run lint`
- `npm test` — synthetic fixtures and mocked AI only; data isolated under `.test-data/unit`.
- `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` — verified using installed Google Chrome in a fresh isolated profile. Alternatively install Playwright Chromium with `npx playwright install chromium` and run `npm run test:e2e`.
- Browser tests start their own server at `127.0.0.1:3100`, use `.next-e2e` for build output and `.test-data/browser` for storage, and explicitly disable the real Anthropic API key.
- `AUTOPOST_BUILD_DIR=.next-build npm run build`
- `npm audit --audit-level=moderate`
- `git diff --check`
- Last verified suite: 54 unit/integration tests and 5 browser tests. Real provider quality, AirDrop, and native Instagram upload remain manual acceptance checks.
- A Vite notice about the current CommonJS config loader is non-blocking. ESLint 9 and TypeScript 5.9 are pinned for compatibility with the current Next lint plugins; upgrading either requires rerunning the complete checks.

## Architecture and important invariants
- `src/lib/domain.ts`: schemas and immutable post/slide helpers. Source assets and slides are distinct; a photo can intentionally appear more than once with different framing.
- `src/lib/layout.ts`: shared source/target rectangles for SVG preview and Sharp export. Keep both paths consistent and preserve source composition in fit mode.
- `src/lib/server/storage.ts`: bounded uploads, input validation, exact source-copy checksums, EXIF orientation, sRGB derivatives, and alpha-preserving previews. Legacy JPEG derivatives remain readable.
- `src/lib/server/db.ts`: local SQLite metadata. `AUTOPOST_TEST_SCOPE=unit|browser` selects fixed isolated test paths; production defaults to `data/`.
- `src/lib/server/http.ts`: compare browser Origin against validated local Host and port, not Next's normalized internal `request.url` hostname. The regression tests cover this distinction.
- `src/lib/server/ai/`: cached descriptors, structured proposals, semantic validation of IDs/pins, and transactional budget reservations. Analysis output uses required named slots (`photo_1`, etc.), and curation uses enum-constrained short references; the server alone maps these back to real asset IDs. Never ask the model to transcribe UUIDs or recover malformed output by array position. This transport change preserves the validated `editorial-v1` cache format to avoid unnecessary reanalysis. Keep implicit SDK retries disabled. The app permits at most one explicit retry for transient HTTP/network errors, with a delay, a separate budget reservation, and the same run ID. Never retry authentication/schema failures or ignore a long Retry-After delay. Never fabricate successful AI results.
- `src/app/api/[...path]/route.ts`: guarded local project, asset, analysis, curation, and export routes. Original paths and credentials are never returned to the client.
- `src/lib/useProject.ts`: serialized revision-checked autosave and bounded undo history. Preserve conflict detection rather than silently overwriting other tabs.
- `src/components/`: collection home, source library, React Flow post board, editor, and AI draft review. Board coordinates are independent of carousel order. Apply all React Flow node changes locally, including measured dimensions and dragging state; persist final positions on drag stop rather than rebuilding unmeasured nodes or saving every pointer move.
- The curation panel displays cached/remaining counts and separates recorded token cost from held estimates. Resume reuses the current run ID and skips cached analyses; neither held estimates nor the local ledger are an Anthropic invoice.
- Tests use synthetic images and mocked providers, not the user's photographs. Build tracing excludes private media, test data, and environment files.
