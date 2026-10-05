# DigitalOcean setup for play.blazarforce.net

The droplet installs Seal Forge on first boot if you paste `deploy/digitalocean-cloud-init.yaml` into User data. The reward key is not in that file.

## You do this

1. Create a DigitalOcean account and add an SSH key.
2. Create a Droplet: Ubuntu 24.04, Basic, 1 GB RAM ($6) or 2 GB, a region near the players, your SSH key.
3. Open Advanced and paste the cloud-init file into User data.
4. Create a firewall named `seal-forge` and allow inbound TCP 22, 80, and 443. Attach it to the droplet.
5. Copy the public IPv4.
6. At GoDaddy, DNS for `blazarforce.net` (nameservers `ns65.domaincontrol.com` and `ns66.domaincontrol.com`): add an A record, host `play`, value that IPv4, TTL 600. Do not change the apex record.
7. SSH in and set the signer, then restart:

```bash
ssh root@YOUR_IP
echo 'SEAL_FORGE_SIGNER=0xYOUR_KEY' > /etc/seal-forge.env
chmod 640 /etc/seal-forge.env
chown root:sealforge /etc/seal-forge.env
systemctl restart seal-forge
```

Do not send that key in chat.

## After each step

- After the droplet exists: send the public IP only. I can check that port 80 answers and that the health URL resolves.
- After the GoDaddy record: I can check `https://play.blazarforce.net/api/veilforge/health`.
- I cannot create the DigitalOcean account, pay for the droplet, open the firewall, edit GoDaddy, or SSH in.
