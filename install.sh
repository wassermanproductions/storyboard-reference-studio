#!/usr/bin/env bash
# Storyboard Reference Studio macOS installer
#
# Downloads the latest release and installs it to /Applications, bypassing
# the Gatekeeper "app is damaged" false alarm that macOS shows for
# browser-downloaded unsigned apps (terminal downloads aren't quarantined).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/wassermanproductions/storyboard-reference-studio/main/install.sh | bash
set -euo pipefail

REPO="wassermanproductions/storyboard-reference-studio"

if [ "$(uname -m)" != "arm64" ]; then
  echo "Storyboard Reference Studio for macOS currently ships for Apple Silicon (M1–M4) only." >&2
  echo "On Intel Macs, build from source — see the README." >&2
  exit 1
fi

echo "Finding the latest Storyboard Reference Studio release..."
URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=20" \
  | grep -o 'https://[^"]*mac-arm64\.dmg' | head -1)"
if [ -z "$URL" ]; then
  echo "Could not find a macOS download — see https://github.com/$REPO/releases" >&2
  exit 1
fi

DEST="/Applications"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Storyboard Reference Studio..."
curl -fL --progress-bar "$URL" -o "$TMP/storyboard.dmg"

echo "Installing to $DEST..."
MOUNT="$(hdiutil attach -nobrowse -readonly "$TMP/storyboard.dmg" | grep -o '/Volumes/.*' | head -1)"
rm -rf "$DEST/Storyboard Reference Studio.app"
cp -R "$MOUNT"/*.app "$DEST/"
hdiutil detach "$MOUNT" -quiet

echo "Done — Storyboard Reference Studio is installed in $DEST."
echo "Open it from Launchpad or: open -a \"Storyboard Reference Studio\""
