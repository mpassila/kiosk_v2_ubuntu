#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KIOSK_DIR="$SCRIPT_DIR/kiosk"

echo "========================================"
echo "Installing kiosk dependencies (production only)"
echo "========================================"

cd "$KIOSK_DIR"
git pull
npm install --omit=dev --ignore-scripts

echo ""
echo "========================================"
echo "Install complete!"
echo "========================================"
