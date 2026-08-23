#!/usr/bin/env bash
# One-time setup for the docsend-dataroom-capture skill.
#
# Creates a dedicated virtualenv (so nothing is installed into the system
# Python), installs Playwright + python-docx + Pillow, and downloads the
# Chromium build Playwright drives. Re-running is safe and fast.
#
# Usage:  bash setup.sh [venv-path]
#         default venv path: ~/.docsend-capture/venv
set -euo pipefail

VENV="${1:-$HOME/.docsend-capture/venv}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating virtualenv at $VENV"
  python3 -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet -r "$HERE/requirements.txt"

# Skip the download when a Chromium is already provided by the environment.
# A failed download is not fatal: the Python side is usable, and the capture
# script can drive any Chromium via --browser-path. Say so instead of dying.
BROWSER_OK=1
if [ -z "${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}" ]; then
  "$VENV/bin/python" -m playwright install chromium || BROWSER_OK=0
fi

echo
echo "Ready. Use this interpreter for the skill's scripts:"
echo "  $VENV/bin/python"

if [ "$BROWSER_OK" -eq 0 ]; then
  echo
  echo "NOTE: Chromium could not be downloaded (offline, or a proxy blocked"
  echo "cdn.playwright.dev). Python packages installed fine. Either retry:"
  echo "  $VENV/bin/python -m playwright install chromium"
  echo "or point the capture script at a Chromium already on this machine:"
  echo "  --browser-path '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'"
fi

echo
echo "Example:"
echo "  $VENV/bin/python $HERE/capture_dataroom.py <room-url> --email you@example.com --out ~/Desktop/room"
