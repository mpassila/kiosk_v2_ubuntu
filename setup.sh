#!/bin/bash
# One-time setup for kiosk mode — run once after OS install

set -e

echo "Disabling sleep/suspend/hibernate..."
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

echo "Creating X11 power management config..."
sudo mkdir -p /etc/X11/xorg.conf.d
sudo tee /etc/X11/xorg.conf.d/10-monitor.conf << 'EOF'
Section "ServerFlags"
    Option "BlankTime" "0"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime" "0"
EndSection

Section "ServerLayout"
    Identifier "Default Layout"
    Option "BlankTime" "0"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime" "0"
EndSection
EOF

# Make scripts executable
chmod +x "$( cd "$(dirname "$0")" && pwd )"/*.sh

echo ""
echo "Setup complete. Screen will never sleep or blank."
