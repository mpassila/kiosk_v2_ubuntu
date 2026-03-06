#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KIOSK_DIR="$SCRIPT_DIR/kiosk"

echo "========================================"
echo "Installing kiosk dependencies (production only)"
echo "========================================"

cd "$SCRIPT_DIR"
git pull
cd "$KIOSK_DIR"
npm install --omit=dev --ignore-scripts

echo ""
echo "========================================"
echo "Install complete!"
echo "========================================"
