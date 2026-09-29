#!/usr/bin/env bash
# Enforces the read-only rule for the Lightroom plug-in and checks Lua syntax.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
plugin="$root/integrations/lightroom/AutoPost.lrdevplugin"

forbidden='withWriteAccessDo|withProlongedWriteAccessDo|setRawMetadata|setPropertyForPlugin|addPhoto|createPhoto|LrFileUtils\.(delete|moveToTrash|move|copy|createDirectory|createAllDirectories)|LrShell|LrFtp|LrSocket|LrMetadataProvider|LrDevelopController|os\.(remove|rename|execute|exit)|io\.(open|popen|write|output)'

if grep -nE "$forbidden" "$plugin"/*.lua; then
  echo "Forbidden API found in the Lightroom plug-in. It must stay read-only." >&2
  exit 1
fi
echo "Read-only check passed."

# The SDK's bundled luac is unsigned, so macOS Gatekeeper blocks it; use a trusted luac instead.
luac="${LUAC:-luac}"
if ! command -v "$luac" >/dev/null 2>&1; then
  echo "Skipping Lua syntax check: no luac found (e.g. brew install lua, or set LUAC)." >&2
  exit 0
fi
for file in "$plugin"/*.lua; do "$luac" -p "$file" </dev/null; done
echo "Lua syntax check passed."
