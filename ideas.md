
1. Iphone post preview: then I would want to have an Iphone preview. That would be super cool not sure how to do something like that. Feels like that is a bigger feature lets park it
2. Iphone feed preview


3. Auto post and post creation: skip sending to phone and set it to timer when it should be posted etc

- this is bit tedios i might postpone but it would be nice as an idea.

4. version control and maybe not autosave?

5. 

---

# Roadmap ideas (organised)

The core insight: today the app goes **photos → posts**, but the real workflow has a step in between.

```
Lightroom (★ selection) → Library (with ★) → Series / themes → Posts → Feed
```

## Suggested order

1. Stars in the app (read from Lightroom) + filter / rate in app.
2. Series layer (manual first, then AI suggest / expand).
3. Send to iPhone (ordered) + grid preview + iPhone post preview.
4. Lightroom Classic publish plugin (real sync). ← exploring first, see below
5. Pairwise compare mode within a series.
6. Instagram auto-posting (parked).

## A. Ratings & selection

My real selection funnel (Sziget example): ~14k shot → 660 edited → 340 ★ → 160 ★★ → 69 ★★★ → 28 ★★★★ → 7 ★★★★★.
★1 = edited / potential, often fillers (people shots etc.). ★3+ = real candidates. ★4–5 = the best.

- Show stars on thumbnails; filter "at least ★N" like the Lightroom filmstrip.
- Rate in the app with 0–5 keys.
- Feed ratings to the AI: covers and highlights from ★4–5, ★1 used as supporting/filler slides. Ratings encode judgement the AI can't infer from pixels.
- Quick win before the plugin: read `xmp:Rating` + keywords embedded in JPEGs exported from Lightroom (export with metadata included).
- **Elo / pairwise ranking**: complement stars, not replace. Use it to split ★3 vs ★4/5, choose a cover, or order a series. Compare within a series (DJ vs DJ), not across.

## B. Series / themes (core concept)

How I actually grouped Sziget: one concert, daylight (before dark), main stage, crowd, dancing (inside the crowd), a birthday story, all the DJs, Artist A / B, Series A / B / C.
Manual grouping took long, and AI curation didn't feel like *my* grouping — it skipped the theme step.

- A **series** = named group + short brief (e.g. "DJs — every DJ, close and moody"). A photo can belong to several series.
- Human-first: create, drag in, remove with one click.
- AI as an assistant at each step:
  - *Suggest series* from the cached photo descriptors → accept / rename / discard.
  - *Expand this series* → "find more like these" among unassigned photos, shown as suggestions.
  - *Series → posts* → one series becomes one or more posts; order and cover chosen inside the series, guided by stars.
- Board shows which series a post came from.
- Cheaper, more predictable AI: runs scoped to one series instead of the whole collection.
- Open question: series → exactly one post, or can it split ("DJs part 1 / part 2")?

## C. Getting posts to the phone

Pain: export to folder → AirDrop → lands in Files, not Photos → save each folder manually → order lost.

- Folders/ZIPs go to Files; **individual JPEGs AirDropped go to Photos**. Add "Send to iPhone" that opens the macOS share sheet with one post's images.
- Order is lost because exports strip all metadata, so Photos sorts by arrival. Option (opt-in): write only a synthetic capture time, 1 second apart per slide, no GPS/camera data. Relaxes the current "no EXIF in exports" rule, so make it explicit.

## D. Previews

- **Profile grid preview**: covers in board order, 3 columns, to plan the feed rhythm (colour, day/night). Cheap and very useful.
- **iPhone post preview**: phone frame, swipeable carousel at real aspect ratio, profile name, caption. Smaller than it seems.

## E. Auto-posting (parked)

- Instagram publishing API needs a Business/Creator account + Meta developer app.
- Images must be at a public URL — conflicts with local-only.
- No built-in scheduling; the app would need to be running at post time.
- Meta Business Suite already schedules carousels for free → "Send to iPhone" + Business Suite covers most of it.

## F. Version control instead of pure autosave (raw idea)

- Named snapshots / versions of a collection ("before AI run", "final Sziget set") on top of autosave.

---

# Exploration: Lightroom Classic plugin

Goal: Lightroom Classic stays the place for editing and rating; AutoPost becomes a **publish destination** (like Flickr / Adobe Portfolio in the Publish Services panel). Also a learning project for photo-software plugin development.

## How Lightroom Classic plugins work

- Written in **Lua 5.1** against the Lightroom Classic SDK (free download from Adobe's developer site; includes API docs and a Flickr sample publish plugin — the best starting template).
- A plugin is a folder named `Something.lrplugin` with an `Info.lua` manifest. Added via *File → Plug-in Manager*, which can also reload it during development.
- Relevant SDK pieces:
  - `LrExportServiceProvider` in `Info.lua` → a **publish service provider** script (`supportsIncrementalPublish = 'only'` makes it publish-only).
  - `processRenderedPhotos(functionContext, exportContext)` → Lightroom renders each photo with its edits (JPEG, chosen size), the plugin uploads it.
  - `photo:getRawMetadata('rating')`, plus keywords, color label, pick flag, capture time, `uuid` → sent alongside each image.
  - `LrHttp.postMultipart(url, content, headers)` → upload file + metadata to AutoPost.
  - `rendition:recordPublishedPhotoId(remoteId)` → Lightroom remembers the AutoPost asset ID, so edits mark photos "Modified — to re-publish".
  - `deletePhotosFromPublishedCollection` → called when you remove photos from the published collection.
  - Published collections ↔ AutoPost collections (e.g. an LR published collection "Sziget 2026" ↔ AutoPost collection "Sziget 2026").
  - `LrLogger` for debug logs; `LrTasks` / `LrFunctionContext` for async work; `LrView` for the settings dialog.

## Proposed flow

1. In AutoPost: *Settings → Connect Lightroom* generates a **local pairing token**.
2. In Lightroom: install `AutoPost.lrplugin`, add the "AutoPost" publish service, paste the token.
3. Create a published collection (or smart collection, e.g. "rating ≥ ★1 in Sziget folder").
4. Publish → Lightroom renders edited JPEGs → plugin uploads each with metadata → AutoPost imports via the existing checksum-verified copy pipeline.
5. Edit or re-rate in Lightroom → republish → AutoPost updates the derivative and rating; existing posts keep referencing the same asset.

## Design constraints (from AGENTS.md)

- Server stays on `127.0.0.1`. The plugin talks to `http://127.0.0.1:3000`.
- **Host/origin guard**: `LrHttp` sends no browser `Origin`, so current mutation routes correctly reject it. Needs a dedicated route (e.g. `/api/integrations/lightroom/*`) that still validates Host but authenticates with the pairing token instead of Origin. Token revocable, stored hashed, never returned to the browser.
- Publishing is an explicit user action → consistent with "import only through explicit user selection". The plugin never touches the source RAW folders; it only sends rendered copies.
- Unpublish in Lightroom → mark as removed/unlinked in AutoPost, never silently delete assets used in posts.
- Keep rendered JPEGs as the source copy (edited result is what gets posted).

## Open questions to verify during the spike

- Does a **rating-only change** mark a photo "to re-publish"? (`metadataThatTriggersRepublish` covers several fields; rating may not be one.) If not: add a *Library → Plug-in Extras → Sync ratings to AutoPost* command that sends only metadata, no re-render.
- Two-way ratings (AutoPost → Lightroom): possible via `photo:setRawMetadata('rating', n)` inside `catalog:withWriteAccessDo`, pulled by a plugin command. Later.
- Map Lightroom keywords / collections to AutoPost series?
- Render size: full-res long edge vs a capped size (e.g. 2160–3000 px) for speed and disk.
- AutoPost not running when publishing → clear error in Lightroom, no partial state.

## Spike plan

1. Hello world: `AutoPost.lrplugin` with `Info.lua` + a menu item that logs selected photos' ratings (learn tooling, reload, logs).
2. Minimal publish service: render + `LrHttp.postMultipart` to a local test endpoint that only logs what it receives (no import yet).
3. AutoPost side: pairing token + guarded `/api/integrations/lightroom/publish` that imports into a chosen collection and stores rating/keywords/LR uuid.
4. Republish/update + unpublish handling.
5. Ratings in the AutoPost UI (stars on thumbnails, filter).
6. Where it lives: `integrations/lightroom/AutoPost.lrplugin/` in this repo, with a short README for install.
