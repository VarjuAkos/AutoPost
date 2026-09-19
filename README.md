# AutoPost

**The missing step between Lightroom exports and Instagram.**

A local-first photography studio that turns an edited shoot into intentional, ready-to-post carousels. Organize photographs yourself or collaborate with AI, refine the sequence and framing, and export the finished slides without changing your originals.

Built during the Devin Budapest Hackathon from a real photographer’s workflow—not a hypothetical social-media dashboard.

## Why this exists

The photographs are already taken, edited, and selected. Then they sit unpublished.

The remaining work is surprisingly tedious: deciding which images belong together, finding the right order, cropping without losing the composition, and adding padding so a landscape photograph fits a portrait carousel.

AutoPost handles that last mile. The question is not just **“Which photographs are best?”** but **“Which photographs work together?”**

```text
Import → Organize → Curate → Preview → Refine → Export
```

AutoPost is not a Lightroom replacement or a social scheduler. Despite the name, publishing is intentionally manual: export the images, transfer them to your phone, add music in Instagram, and post when ready.

## What you can do

- **Build collections.** Import edited JPEG/PNG files or folders, search by filename or section, and see which photographs are unused.
- **Work on a visual board.** Arrange movable post cards on a pan-and-zoom canvas, or switch to contact sheets. Add and move photos between stories.
- **Explore AI curation.** Ask for an editorial story, connections in color and mood, or a chronological sequence. Review suggestions before applying them.
- **Keep creative control.** Reorder slides, duplicate a photograph for a detail/full-image pair, and pin positions before asking AI to rework a post.
- **Frame without destroying the original.** Choose white or black gallery framing, whole-image fit, custom backgrounds, adjustable margins, or full-bleed crop with pan and zoom.
- **Export a finished carousel.** Download a ZIP of ordered `01.jpg`, `02.jpg`, … slides at **1080 × 1350**, converted to sRGB with EXIF removed.
- **Pick up where you left off.** Projects, edits, board positions, and successful AI analyses are saved locally. Interrupted AI runs skip already analyzed photos when resumed.

**Manual organization, editing, and export work without an API key.**

## Quick start

### Requirements

- Node.js **22.x (22.17+)**; development was verified with Node 22.17.1 and npm 11.7.0.
- npm.
- Your own edited JPEG or PNG photographs. Private source images are not included in this repository.

```bash
git clone https://github.com/VarjuAkos/AutoPost.git
cd AutoPost
npm ci
npm run dev
```

Open **http://127.0.0.1:3000** directly. No app account or sign-in is required.

### Your first carousel

1. Click **Start a collection** and give it a name.
2. Import a few JPEGs or PNGs. AutoPost makes verified local copies; it does not edit or move the source files.
3. Select photos in the library and click **Make a post**.
4. Open the post, arrange the slides, and try **White**, **Black**, or **Full bleed**.
5. Click **Export ZIP**.
6. Transfer the exported slides to your phone and publish through Instagram yourself.

This is also the quickest way for a judge or reviewer to test the application without setting up AI access.

## Optional: enable AI curation

You need an Anthropic API key scoped to the workspace containing your API credit. A Claude subscription or Devin subscription does not supply the application’s Anthropic API balance.

For a fresh checkout:

```bash
cp .env.example .env.local
```

Edit `.env.local` locally:

```dotenv
ANTHROPIC_API_KEY=your_workspace_scoped_api_key
AUTOPOST_AI_LIMIT_USD=1
```

Restart the development server, open **Curate with AI**, select a direction, and approve the analysis. **Claude Haiku 4.5** analyzes photographs; **Claude Sonnet 4.6** composes posts from the saved descriptions and your creative direction. Existing Haiku analyses stay cached—switching the composer does not resend those photographs. Standard input/output pricing per million tokens is $1/$5 for Haiku and $3/$15 for Sonnet; both budget reservations and recorded token costs use the corresponding model’s rates.

| Setting | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required only for AI. Keep it in an ignored local environment file; never commit it. |
| `AUTOPOST_AI_LIMIT_USD` | Persistent local application allowance in USD; defaults to `1`. This is not an Anthropic account balance or a daily reset. |

An unscoped, multi-workspace key requires an explicit workspace header. This app’s documented setup uses a **workspace-scoped key** instead.

### How the AI workflow behaves

1. Analyze reduced-size, metadata-stripped copies in small batches.
2. Cache structured descriptions of subject, light, palette, composition, mood, and editorial role.
3. Consider the entire chosen catalog together—not separate analysis batches—and propose highlights from those descriptions and your creative direction.
4. Validate photo references and pinned positions, then show proposals for your review.

The model returns compact assignment records: an explicit photo reference and a post/slide position, or “unused.” The server requires every selected photo exactly once and validates positions, sequence lengths, and pins before mapping references to actual photographs; it never matches by array position, guesses, silently drops duplicates, or fills gaps. This compact schema avoids Anthropic’s grammar-size limit for large per-photo objects. Failed composition leaves cached analyses intact so an explicit retry only regenerates the posts.

Choose **Whole collection** or **Selected photos**, then use **Auto** to discover a sensible number of strong stories or request an exact count from **1–20**. Set a minimum and maximum photos per post. The review reports how many photos were considered, chosen, and left unused; highlights do not have to cover every image.

Approve a **per-run spending allowance** in the UI (default **$0.50**, configurable from $0.05 up to $20, never above the total app allowance). A resumed run retains its approved cap. Changing settings starts a new run and requires consent again without discarding cached analyses. Each request allows at most one eligible transient retry, with a separate budget reservation per generation attempt. Authentication and malformed-output failures are not blindly retried.

The interface separates **recorded token cost** from **held reservations**. A held reservation is a conservative estimate for an in-flight or uncertain request—not confirmed spending. Anthropic’s billing records remain the source for actual charges. Successful generations can incur costs even if a later batch fails or the generated result cannot be accepted.

## Privacy and photo safety

- **Originals are untouched.** Imports are copied into the app’s library and verified using SHA-256 checksums.
- **Edits are non-destructive.** Cropping and framing are stored as layout parameters. Export renders from the copied originals, not screenshots of the preview.
- **Storage is local.** Photographs and SQLite metadata live under `data/`, outside the public-assets directory and excluded from Git.
- **AI is opt-in.** When you approve curation, reduced-size photo copies and analysis/context are sent to Anthropic. Local-first does not mean offline when AI is enabled.
- **Secrets stay server-side.** Environment files are Git-ignored; `.env.example` contains placeholders only.
- **Tests use synthetic images and mocked AI.** Running the automated suites does not require your photographs or consume Anthropic inference credit.

`data/` contains your imported library, projects, and analysis cache. Treat it as user data: back it up if needed, and do not delete it as a troubleshooting shortcut.

The app binds to **127.0.0.1** and enforces local host/origin checks. Do not expose this unauthenticated local server through a public tunnel. Use its direct URL rather than a browser-preview proxy that changes the origin.

## Built with Devin

The project began with a photographer’s voice memo describing the friction between finished images and published posts, then evolved through testing with real festival photographs.

**Human contribution:** the problem, scope decisions, photography, visual references, creative direction, API setup, and hands-on feedback.

**Devin contribution:** collaborative planning, the full-stack implementation, interface, local persistence, image-processing/export pipeline, AI integration, regression tests, and iterative debugging.

The work included addressing real failures—not just producing a happy-path demo: local origin mismatches, workspace-scoped API access, inconsistent model photo IDs, partial batch completion, provider errors, spending reservations, and React Flow drag initialization.

## Technology and architecture

| Layer | Technology |
| --- | --- |
| Application | Next.js App Router, React, TypeScript |
| Interface | Tailwind CSS, React Flow, Lucide |
| Local persistence | SQLite with better-sqlite3, app-owned files |
| Image processing | Sharp, exifr |
| AI | Anthropic SDK, Haiku 4.5 analysis, Sonnet 4.6 composition, Zod validation |
| Export | Server-rendered JPEGs, streamed ZIP archives |
| Verification | Vitest, Playwright |

```text
src/components/              Collection home and project workspace
  library/                   Import queue and source photographs
  board/                     Spatial post board and AI proposal review
  editor/                    Carousel sequence and framing controls
src/lib/domain.ts            Shared schemas and post/slide operations
src/lib/layout.ts            Geometry shared by preview and export
src/lib/useProject.ts        Revision-checked autosave and undo
src/lib/server/              SQLite, storage, image rendering, HTTP guard
  ai/                        Analysis cache, curation, retry/budget handling
src/app/api/[...path]/       Guarded local API routes
tests/                      Unit, integration, and browser workflows
```

## Verification

The hackathon implementation was verified with **85 unit/integration tests and 8 browser tests**, plus typechecking, linting, and a production build. AI-provider behavior is mocked in automated tests; live model quality and native Instagram upload remain manual checks.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Browser tests:

```bash
npx playwright install chromium
npm run test:e2e
```

Alternatively, with Google Chrome installed:

```bash
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

Tests use isolated storage under `.test-data/`. Browser tests start a separate local server on port `3100` and explicitly disable the real API key.

To run a production build locally, stop the development server first:

```bash
npm run build
npm start
```

Additional maintenance and safety guidance is in [AGENTS.md](AGENTS.md).

## Current scope and limitations

- Desktop-first, single-user, local application. There is no hosted service or cloud sync.
- Edited JPEG and PNG input only, up to 50 MiB and 100 megapixels per file. RAW and HEIC are not supported.
- The editor exports 4:5 carousels, with up to 20 slides. AI curation supports up to 500 explicitly chosen photos per run, analyzed in cached batches of six. Larger selections show a warning rather than silently dropping photos. Automated tests cover 170- and 300-photo collections; live curation quality still depends on the material and provider.
- AI suggestions are subjective editorial proposals, not objective photography scores or engagement guarantees.
- No direct Instagram publishing, account import, scheduling, music integration, stories, advanced collages, or generative expansion.
- Not a drop-in Vercel deployment: persistent local SQLite/photo storage needs a different storage architecture for serverless hosting. A public version would also need authentication, access control, and protected AI spending.

The goal is deliberately narrow: **get good photographs out of the backlog and into a post you actually want to publish.**
