# Host the Seal Forge table

`blazarforce.net` stays the BlazarSwap GitHub Pages site. The match server belongs on `play.blazarforce.net`. Rewards still pay from the Polygon contract `0xc802dd850fc3ada4ebc6075300d73df0aec665cf`. The box only keeps the room and signs the win receipt.

Local installs already probe `https://play.blazarforce.net/api/veilforge/health` every 15 seconds. If that answers, queue, profile, and reward calls go to the box. If it does not, the install keeps the match on that machine.

## What you do

1. Rent a small Linux VPS with a public IPv4 address. Node 22 is required.
2. In the DNS host for `blazarforce.net`, add an A record: `play` to that IPv4. Do not change the apex record. GitHub Pages must keep serving the swap site.
3. On the box:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git caddy
sudo useradd --system --create-home --home-dir /opt/seal-forge sealforge || true
sudo git clone https://github.com/cannergtfo-commits/seal-forge.git /opt/seal-forge
sudo chown -R sealforge:sealforge /opt/seal-forge
sudo -u sealforge bash -lc 'cd /opt/seal-forge && npm install'
```

4. Put the reward signer key in the service, not in git. Edit `/etc/systemd/system/seal-forge.service` from `deploy/seal-forge.service` and set `SEAL_FORGE_SIGNER` to the `0x` private key that owns the rewards contract. Then:

```bash
sudo cp /opt/seal-forge/deploy/seal-forge.service /etc/systemd/system/seal-forge.service
sudo systemctl enable --now seal-forge
sudo cp /opt/seal-forge/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

5. Check `https://play.blazarforce.net/api/veilforge/health`. It should return `{"ok":true,"service":"seal-forge"}`.

A local game started with `npm run dev` or the installer will log `table https://play.blazarforce.net` when that check passes.
