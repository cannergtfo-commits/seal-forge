#!/bin/bash
# Swap the droplet off the Vite dev server and onto the built table.
set -euo pipefail
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
systemctl stop seal-forge || true
cd /opt/seal-forge
git pull --ff-only
chown -R sealforge:sealforge /opt/seal-forge
sudo -u sealforge bash -lc 'cd /opt/seal-forge && npm install && NODE_OPTIONS=--max-old-space-size=1400 npm run build:host'
install -m 644 /opt/seal-forge/deploy/seal-forge.service /etc/systemd/system/seal-forge.service
systemctl daemon-reload
systemctl enable seal-forge
systemctl restart seal-forge
systemctl is-active seal-forge
