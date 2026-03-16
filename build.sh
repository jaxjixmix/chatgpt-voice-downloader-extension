#!/usr/bin/env bash
set -euo pipefail

# Build script: packages the Chrome extension for distribution.
# Produces two artifacts in dist/:
#   1. chatgpt-voice-downloader.zip     — for users to load unpacked in Chrome
#   2. chatgpt-voice-downloader-cws.zip — for Chrome Web Store upload (identical contents)

DIST_DIR="dist"
ZIP_NAME="chatgpt-voice-downloader.zip"
CWS_ZIP_NAME="chatgpt-voice-downloader-cws.zip"

echo "Cleaning dist/..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "Zipping extension/..."
(cd extension && zip -r "../${DIST_DIR}/${ZIP_NAME}" . -x ".*")

echo "Creating Chrome Web Store zip..."
cp "$DIST_DIR/$ZIP_NAME" "$DIST_DIR/$CWS_ZIP_NAME"

echo ""
echo "Build complete:"
ls -lh "$DIST_DIR"
echo ""
echo "dist/"
echo "  $ZIP_NAME     ($(du -h "$DIST_DIR/$ZIP_NAME" | cut -f1)) — load unpacked in Chrome"
echo "  $CWS_ZIP_NAME ($(du -h "$DIST_DIR/$CWS_ZIP_NAME" | cut -f1)) — upload to Chrome Web Store"
