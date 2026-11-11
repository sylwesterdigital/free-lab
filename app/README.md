# Free Lab — Spatial Collector v0.1.1

A standalone Quest 3 + Meta Muse MVP: native WebXR immersive AR, hand/controller selection, opt-in camera snapshots, per-user SQLite inventory, administrator-managed profiles, private-by-default publishing and cost-capped Muse object detection. **No frontend CDN or API key required for manual mode.** No WebRTC multiplayer or continuous camera inference is implemented in this v0.1.1; these are future extension points.

## Requirements
- macOS M2 Pro (or any machine with Python 3.10+), Quest 3 with a recent Quest Browser, or a desktop browser for the 2D UI.
- Ubuntu server: Python 3, `python3-venv`, nginx, systemd, existing valid Let's Encrypt certificate for `free-lab.cam`, inbound HTTPS, outbound PyPI/Meta API.
- Production inference: Meta Model API key from https://dev.meta.ai. Never enter it in browser or ZIP.

## Local start (no paid token use)

From repository root after watcher has installed `app/`:

```bash
cd app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export FREE_LAB_DB="$PWD/var/free-lab.sqlite3"
python -m backend.cli create-admin admin
python -m backend.app
```

Open `http://127.0.0.1:8765` on the Mac. In desktop mode, try **Upload snapshot**, enter a label, **Save privately**. Localhost works for many browser APIs; Quest must open the deployed **HTTPS** URL. `MODEL_API_KEY` is deliberately empty until configured, so **Recognize** will not call the API.

To enable model recognition locally:

```bash
export MODEL_API_KEY='your-secret-key'
export META_MODEL='muse-ember-1.0'
export FREE_LAB_DAILY_LIMIT=24
export FREE_LAB_USER_DAILY_LIMIT=8
python -m backend.app
```

## Quest 3: what works and what depends on browser
1. Browse to `https://free-lab.cam` in Quest Browser and sign in. Press **Enter SR** to request `immersive-ar` passthrough.
2. Aim at the floating panel and use controller trigger or hand *point-and-pinch* to select. Controller **squeeze** is the capture shortcut. Quest's system palm-pinch is **not** overridden.
3. For real camera pixels, choose **Enable camera** before entering SR; grant permission if prompted. If Quest Browser denies access, use **Upload snapshot** from a supported source. A WebXR passthrough compositor frame **cannot** be read back from WebGL or used as an image for Muse.
4. Capture a frame; **Recognize** uses one image and saves at most six labels privately. Manual snapshots and text-only entries do not consume Meta API credits.

**Important:** Some Quest Browser versions expose only an avatar camera, deny `facingMode: environment`, or don't prompt for headset camera permission. This MVP does not claim that camera access always works. Do not assume enabling camera selected the actual forward-facing camera; verify the preview. The native Quest Passthrough Camera API is a future optional Android bridge if unrestricted RGB access is required.

## Data and security
- SQLite WAL in `/var/lib/free-lab/free-lab.sqlite3` in production; snapshot JPEGs in `/var/lib/free-lab/images/`. Both persist across releases.
- Profiles are created by the first administrator through **Profile → Add another profile**. No public registration endpoint.
- Passwords use salted PBKDF2-HMAC-SHA256, session cookies are HttpOnly, SameSite=Lax and Secure under HTTPS. APIs check origin and a custom header on writes; nginx terminates HTTPS.
- Photos are private by default, only available to owner. **Public** shares to a community list; **Share link** creates an unguessable token and URL, revocable by switching visibility.
- No continuous video transmission, no automatic model retries, no model call when key is missing. Do not upload images of people, bystanders, sensitive documents or private material without permission. Provider calls transmit chosen JPEG snapshots to Meta.
- Server limits default to **24 inference requests / rolling day in total**, **8 / user / rolling day**, **20 seconds between user requests**; ≤450 KB JPEG, ≤6 objects per response, one explicit user action per image. Tokens/cost are billed by provider; quotas here are request ceilings, **not a guaranteed dollar cap**.
- Per-day limits include failed provider calls to avoid request storms. There is no autonomous scan loop.
- For the publicly reachable POC, protect admin password, rotate shared links when needed, and consider additional perimeter access controls before broad exposure.

## Ubuntu production configuration

Watcher deploys verified releases using `root@46.62.232.64` on SSH port `333`, switching an atomic `current` symlink at `/var/www/free-lab.cam`. It installs a Python virtualenv in `/opt/free-lab/venv`, a `free-lab.service`, and a new nginx vhost retaining your existing Let's Encrypt certificate locations. Old app releases are kept; the persistent database is never deleted. Existing vhost and unit files are backed up before replacement.

Set `MODEL_API_KEY` on the **server only**, then restart:

```bash
ssh -p 333 root@46.62.232.64
nano /etc/free-lab.env    # set MODEL_API_KEY=... without quoting special shell metacharacters
chmod 600 /etc/free-lab.env
systemctl restart free-lab
systemctl status free-lab --no-pager
journalctl -u free-lab -n 70 --no-pager
```

If an API key contains special characters, use systemd `EnvironmentFile` valid quoting (e.g. `MODEL_API_KEY="..."`). Keep secrets off GitHub and out of release archives. Configure provider model via `META_MODEL=muse-ember-1.0` or `muse-spark-1.3` in the environment file. First deployment prompts for an admin password **only in an interactive `--once` watcher run**; it is transmitted over SSH and not saved in logs or the repo.

## Release process

0. On the Mac, confirm SSH host identity once with `ssh -p 333 root@46.62.232.64` and install Python 3.10+, Git and Node.js. The watcher deliberately refuses unknown SSH host keys. Confirm the VPS already has `python3-venv` and that the site certificate exists.
1. Copy `watch-free-lab.sh` to repo root and `FREE_LAB_RELEASE_v0.1.1.zip` to `uploads/` (or `updates/`). `chmod +x watch-free-lab.sh`.
2. `./watch-free-lab.sh --dry-run` performs manifest SHA256 + version + JS/Python syntax + test checks without SSH/changes.
3. `./watch-free-lab.sh --once` verifies Git origin/main/clean worktree, SSH, server preconditions; prompts for first admin password; deploys to Ubuntu and verifies public HTTPS before committing and pushing to GitHub `main`.
4. `./watch-free-lab.sh` continuously watches **both** `uploads/` and `updates/` for correctly named release ZIPs. Successful archives are moved into `updates/processed/`; rejected archives go to `updates/rejected/`. Failed network/remote operations retain ZIP for retry.
5. `./watch-free-lab.sh --status`, `--tail`, and `--rollback` provide health, logs, rollback to previous server release (no DB rollback).

Future release names must be `FREE_LAB_RELEASE_vX.Y.Z.zip`, with matching `manifest.json`, `app/version.json`, HTML meta version, `app/changelog.json` and all file hashes. The changelog overlay appears once **per version, per browser profile** on login, with a manual Release notes action.

## Future architecture, not shipped in v0.1.1
- Authenticated WebSocket event stream for low-latency collection sync.
- Explicit-consent WebRTC peer connections for multiplayer; TURN/STUN and permissions are not configured.
- Server-side SAM 3.1 segmentation of selected snapshots, location anchors and room mapping; no automatic physical object anchoring yet.
- Optional Unity/Android camera bridge for reliable Quest RGB passthrough capture.

## References
- https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/
- https://developers.meta.com/vr/documentation/web/webxr-hands/
- https://developers.meta.com/vr/support/investigations/1557993751977106/
- https://dev.meta.ai/docs/media-understanding
- https://dev.meta.ai/docs/models
- https://dev.meta.ai/docs/pricing-rate-limits

## v0.1.1 deployment readiness repair

The API uses **127.0.0.1:18765**, rather than 8765 (which may be used by another app on a shared Ubuntu host). The installer validates that the port is either unused or already serving the previously deployed FREE LAB release before changing systemd or nginx. Health checks bypass HTTP proxies and include observed JSON and systemd/journal diagnostics when they fail. The SQLite DB in `/var/lib/free-lab` and `/etc/free-lab.env` persist across upgrades.

To inspect the server without modifying it: `./watch-free-lab.sh --diagnose`. Do **not** delete the database to recover from a readiness failure.
