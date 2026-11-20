# Free packs (gas-free mint window)

**Off by default and inert.** Nothing happens unless you turn it on yourself. No contract changes and no redeploys are involved.

## How it works

1. You fund a **new, dedicated treasury wallet** with BzB and a little POL.
2. A signed-in player who has finished one full server match during the window claims a free pack on `POST /api/veilforge/free-mint`.
3. The server's treasury wallet buys a normal pack through the **existing** pack contract, settles it, and sends the five cards to the player. **The player pays nothing, not even gas.**
4. The BzB the treasury spends goes to VeilRewards, the win-reward pool, exactly like a normal purchase.

Every step stores its transaction hash the moment it is broadcast. A restart picks up where it left off and never buys or sends twice.

## Cost per pack (estimate)

| Edition | BzB | POL gas (estimate; measure on the first run) |
|---|---|---|
| core (Founding), any seal | 1 | ~0.1-0.3 |
| core, chosen seal | 1.25 | ~0.1-0.3 |
| blazar / kage | 10 | ~0.1-0.3 |
| ashen | 15 | ~0.1-0.3 |

## Turning it on

Add these to `/etc/seal-forge.env` (root-owned), then `systemctl restart seal-forge`:

```
FEATURE_FREE_MINT=1
FREE_MINT_SIGNER=0x<private key of the NEW treasury wallet>   # never the keeper / rewards key; the server refuses it
FREE_MINT_START=2026-12-01T00:00:00Z                          # UTC
FREE_MINT_END=2026-12-08T00:00:00Z                            # UTC, exclusive
FREE_MINT_BUDGET_BZB=20                                       # hard cap on BzB spent in this window
FREE_MINT_DAILY_CAP=20                                        # packs per UTC day, all players
FREE_MINT_PER_WALLET=1                                        # 1 or 2
FREE_MINT_EDITION=core                                        # core | blazar | kage | ashen
FREE_MINT_FACTION=0                                           # 0 = any seal, 1-5 = fixed seal, or player-choice
```

Optional settings:

```
FREE_MINT_WINDOW_ID=dec-2026        # name the window; defaults to the start time. A new id resets per-wallet counts
FREE_MINT_IP_DAILY=3                # soft cap per connection per day
FREE_MINT_MIN_TURNS=6               # how long the qualifying match must be
FREE_MINT_ALLOWLIST=/etc/seal-forge-free-mint.txt   # one address per line; if set, only these wallets qualify
TURNSTILE_SECRET=...                # Cloudflare Turnstile; if set, claims need a Turnstile token
```

**Keep only about one day's budget in the treasury,** for example 20 Founding packs = 20 BzB + ~5 POL, and top it up by hand.

## Emergency stop (no restart needed)

```
touch /opt/seal-forge/data/free-mint.stop     # stops new claims and the worker immediately
rm /opt/seal-forge/data/free-mint.stop        # resume
```

You can also set `FREE_MINT_PAUSED=1` (needs a restart), or `FEATURE_FREE_MINT=0` to switch it off entirely. Claims already in progress stay in the database and finish after you resume.

## Who qualifies

- Signed in with the "Seal Forge account" signature. The wallet comes from that sign-in, never from the request.
- Finished at least one server-scored match (Auto start or Find a match), signed in, after the window opened, of at least 6 turns.
- Under the per-wallet, daily, budget and per-IP caps, and on the allowlist if one is set.
