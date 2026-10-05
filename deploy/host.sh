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
if [ -d /opt/seal-forge/.pglite ]; then
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p /var/backups/seal-forge
  cp -a /opt/seal-forge/.pglite "/var/backups/seal-forge/pglite-$stamp"
  ls -1dt /var/backups/seal-forge/pglite-* | tail -n +6 | xargs -r rm -rf
fi
systemctl stop seal-forge || true
chown -R sealforge:sealforge /opt/seal-forge
sudo -u sealforge git -C /opt/seal-forge fetch origin
sudo -u sealforge git -C /opt/seal-forge reset --hard origin/main
sudo -u sealforge bash -lc 'cd /opt/seal-forge && npm install && NODE_OPTIONS=--max-old-space-size=1400 npm run build:host'
install -m 644 /opt/seal-forge/deploy/seal-forge.service /etc/systemd/system/seal-forge.service
systemctl daemon-reload
systemctl enable seal-forge
systemctl restart seal-forge
systemctl is-active seal-forge
