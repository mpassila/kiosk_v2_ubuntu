#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KIOSK_DIR="$SCRIPT_DIR/kiosk"

# Pull latest and install dependencies
"$SCRIPT_DIR/install.sh"

# Start X server in background, then configure display and launch Electron
sudo xinit /bin/bash -c '
  sleep 2
  xrandr --newmode "1024x768_60.00" 63.50 1024 1072 1176 1328 768 771 775 798 -hsync +vsync 2>/dev/null
  xrandr --addmode HDMI-1 "1024x768_60.00" 2>/dev/null
  xrandr --output HDMI-1 --mode "1024x768_60.00"

  # Disable screen blanking and power management
  xset s off
  xset -dpms
  xset s noblank

  exec /usr/bin/electron "'"$KIOSK_DIR"'/release/app/dist/main/main.js" --no-sandbox --remote-debugging-port=9222 --devtools
' -- :0
