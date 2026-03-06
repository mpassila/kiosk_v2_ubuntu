#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KIOSK_DIR="$SCRIPT_DIR/kiosk"

sudo xinit /usr/bin/electron "$KIOSK_DIR/release/app/dist/main/main.js" --no-sandbox --remote-debugging-port=9222 --devtools -- :0
