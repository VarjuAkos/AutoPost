# AutoPost for Lightroom Classic

A publish service that sends edited photos, with their star ratings, from Lightroom Classic to the local AutoPost app.

## Safety

The plug-in is **read-only** towards Lightroom:

- It only reads photo metadata (rating, color label, pick flag, keywords, capture time, photo ID) and the JPEG that Lightroom renders.
- It never writes to the catalog, never changes edits, ratings or keywords, and never moves, copies or deletes photo files.
- Renders go to Lightroom's temporary export folder (the export location setting is hidden). The plug-in does not delete them; macOS cleans that temporary folder.
- Deleting photos from the catalog never deletes anything in AutoPost. Removing a photo from a published collection only marks it as *unlinked* in AutoPost; the copy and any posts using it are kept.
- `scripts/check-lightroom-plugin.sh` fails if the code contains any catalog-writing or file-changing API.

Lightroom itself records publish bookkeeping in the catalog (the service, published collections, which photos are published). It does the same for its built-in Hard Drive and Flickr services.

**Before the first run:** quit Lightroom and back up the catalog (`.lrcat` plus `.lrcat-data`). Try the plug-in in a throwaway catalog first (File → New Catalog, import a few copied photos).

## Install

1. Start AutoPost: `npm run dev` (serves `http://127.0.0.1:3000`).
2. In AutoPost, open **Connect Lightroom** on the home page and click **Generate token**. Copy it; it is shown once.
3. In Lightroom Classic: **File → Plug-in Manager → Add**, choose `integrations/lightroom/AutoPost.lrdevplugin`.
4. In the Library module's **Publish Services** panel, click **Set Up…** next to AutoPost (or `+` → Go to Publishing Manager).
   Paste the token, click **Test connection**, then **Save**. The token is stored in the macOS Keychain, not in the preset.
5. Right-click the AutoPost service → **Create Published Collection** (smart collections work too). Its name becomes the AutoPost collection name.
6. Drag photos in and click **Publish**.

## How updates work

| In Lightroom | In AutoPost |
|---|---|
| Publish a new photo | Imported into the linked collection with rating, label, pick, keywords |
| Change rating, label, keywords, title, caption, capture date | Photo moves to *Modified Photos to Re-Publish*; after Publish only the metadata updates (same image bytes) |
| Edit the photo, then Publish | Image is replaced in place: same photo ID, posts update, the cached AI analysis for that photo is cleared |
| Remove from the published collection | Marked unlinked; nothing is deleted |
| Rename the published collection | AutoPost collection is renamed |
| Delete the published collection | Collection and its photos are marked unlinked; nothing is deleted |

## Development

- After editing Lua files: Plug-in Manager → select AutoPost → **Reload Plug-in**.
- **Library → Plug-in Extras → AutoPost: Log selected ratings** logs ratings for the selected photos. It is a quick way to check the plug-in loads.
- Logs: `~/Library/Logs/Adobe/Lightroom/LrClassicLogs/AutoPost.log` (older versions: `~/Documents/LrClassicLogs/`).
- Checks: `scripts/check-lightroom-plugin.sh`. It runs the read-only guard and, if a trusted `luac` is installed (`brew install lua`) or `LUAC` is set, a syntax check. The SDK's bundled `luac` is unsigned and blocked by macOS Gatekeeper, so it is not used.
- The SDK (docs and samples) is expected at `vendor/lrc-sdk/`. It is not committed; download it from Adobe's developer console.
