#!/usr/bin/env bash
set -euo pipefail

# Build script: packages the Chrome extension as a zip and prepares
# the dist/ folder for deployment (index.html + extension zip only).

DIST_DIR="dist"
ZIP_NAME="chatgpt-voice-downloader.zip"

echo "Cleaning dist/..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "Zipping extension/..."
(cd extension && zip -r "../${DIST_DIR}/${ZIP_NAME}" . -x ".*")

echo "Copying index.html..."
cp index.html "$DIST_DIR/index.html"

echo ""
echo "Build complete:"
ls -lh "$DIST_DIR"
echo ""
echo "dist/"
echo "  index.html"
echo "  $ZIP_NAME ($(du -h "$DIST_DIR/$ZIP_NAME" | cut -f1))"
