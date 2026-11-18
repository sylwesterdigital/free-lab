# FREE-LAB.cam — Application & Developer Guide

**Technical guide for the application source.** For the project introduction, three-minute film and hackathon story, see the [repository README](../README.md) and [ABOUT.md](../ABOUT.md). The repository README is published automatically from [`app/docs/GITHUB_README.md`](docs/GITHUB_README.md) after a successful release.

**Live demonstration:** https://free-lab.cam/ · **Project video:** https://youtu.be/rJ0nFm7jKms

## Architecture

FREE-LAB.cam is a WebXR application built for Meta Quest Browser with desktop and mobile companion experiences. The frontend provides a browser UI, a 3D spatial personal archive (**My Stuff**), and ten interactive activities (**Agency**). The backend stores account-scoped content and progress data and mediates optional third-party model providers.

| Component | Implementation | Where |
| --- | --- | --- |
| Browser client | HTML, CSS, JavaScript, WebXR, WebGL and Three.js | `frontend/` |
| Spatial features | Quest controller and hand inputs, GLB previews, XR video surfaces, immersive galleries | `frontend/assets/` |
| API and authentication | Flask, session handling, permissions, provider operations | `backend/app.py`, `backend/` |
| Records | SQLite; user captures, media, 3D models, game history and aggregated progress | `backend/db.py` |
| 3D asset workflows | GLB validation, preview generation, Blender and browser-side fallback | `backend/` |
| Deployment | Versioned, checksum-verified application releases to Ubuntu/nginx/Gunicorn | `deploy/install.py`, repository-root `watch-free-lab.sh` |
| Tests | Python unittest regression suite, including static JS checks | `tests/` |

The browser client does not require bundling a separate desktop application. Some XR features need a supported headset and permissions. Live Quest passthrough is **not** automatically readable as a camera image from JavaScript.

## Repository layout

```text
README.md                   Public project overview (GitHub landing page)
ABOUT.md                    Project story, challenges and research direction
watch-free-lab.sh           Local versioned release watcher (macOS → Ubuntu)
updates/                    Incoming release ZIPs (local, not source-controlled)
videos/                     Persistent optional explainers (published separately)
app/
  README.md                 This technical and setup guide
  ABOUT.md                  Canonical project story; published to repository root
  docs/GITHUB_README.md     Canonical GitHub landing page; published to repository root
  frontend/                 Browser pages, XR scenes, models and interactions
  backend/                  Flask API, persistence, permissions and integrations
  deploy/                   Ubuntu deployment/rollback
  tests/                    Automated regression tests
  requirements.txt          Python dependencies
  version.json              Application version
  changelog.json            Current release and history
```

## Local development

Requirements: Python 3, an isolated virtual environment, and Node.js for JavaScript syntax checks. Optional 3D preview processing additionally uses Blender. Third-party providers require independent configuration and may incur charges.

From the repository root:

```bash
cd app
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m flask --app backend.app run --debug
```

A local Flask development server is **not** a production server. WebXR immersive mode requires a compatible browser, secure context and suitable headset; browser-based UI features can be developed without a headset. Tests do not call paid model APIs.

JavaScript syntax checks can be run with:

```bash
for f in frontend/assets/*.js frontend/assets/*.mjs; do node --check "$f" || exit 1; done
```

## Runtime configuration

The Ubuntu deployment uses `/etc/free-lab.env` for persistent settings and credentials, outside releases and Git. The service runs as `free-lab` behind nginx with Gunicorn on loopback. Never commit API keys, session secrets, user databases or private captures.

Examples of **optional**, independently configurable progress-analysis allowances:

```dotenv
FREE_LAB_ANALYSIS_ENFORCE_LIMITS=1
FREE_LAB_ANALYSIS_DAILY_LIMIT=120
FREE_LAB_ANALYSIS_USER_DAILY_LIMIT=12
FREE_LAB_ANALYSIS_COOLDOWN_SECONDS=10
```

Provider availability depends on your server configuration. Some tasks use external image, 3D, AI or speech services; these are not required for basic browsing and most self-contained spatial activities. Inference and payment permissions should be reviewed before use.

## Media and HLS explainers

Explainer videos are **not packed into versioned releases**. Each activity may use a persistent folder, served at `/videos/<activity>/video_hls/index.m3u8`:

```text
videos/<activity>/video_hls/index.m3u8
videos/<activity>/video_hls/segment_000.ts
videos/<activity>/video.mp4           # Optional fallback
```

Publish the public static assets independently from the repository root:

```bash
./watch-free-lab.sh --sync-videos
```

This transfers only approved video files to `/var/www/free-lab.cam/videos/` and does not modify application code. Playlist contents must reference adjacent segments with valid relative paths.

## Release & deployment

**Production is deployed through the repository-root watcher;** do not copy application files into the live release directory manually.

1. Build a complete `FREE_LAB_RELEASE_vX.Y.Z.zip` containing `manifest.json`, `watch-free-lab.sh`, and each `app/` file declared in the SHA-256 manifest.
2. Put the ZIP in `updates/` in the local Git repository. Run `./watch-free-lab.sh --dry-run` to validate without deployment.
3. The running watcher validates checksums, Python/JavaScript syntax and tests; checks Git, SSH, nginx and TLS; stages the release on Ubuntu; validates server tests and HTTPS; then commits the verified source to GitHub.
4. After a successful v0.10.72+ deployment, the upgraded watcher also publishes the root `README.md` and `ABOUT.md` from their canonical application documentation sources. If the watcher was invoked using `--once`, run `./watch-free-lab.sh --publish-docs` once to publish those pages.

Only one release version is issued for each build. Failed staging does not make the release successful. The watcher retains safe archive limits and rejects unverified or unsafe paths. User content, `/etc/free-lab.env` and separately synced HLS media persist across releases.

Read-only diagnostics: `./watch-free-lab.sh --status`, `./watch-free-lab.sh --tail` or `./watch-free-lab.sh --diagnose`. Administrative runtime events are available in the application Settings → Logs tab when authorized.

## Data, privacy and scientific limitations

- Captures, media and progress records are per-account; sharing through rooms is a separate feature.
- Optional AI commentary is consent-based and works with aggregated session information rather than raw personal photographs.
- The gameplay dashboard describes observed play time, accuracy, responses and input patterns. **It is not a validated cognitive assessment or clinical claim.** Results depend on practice, difficulty and sample size.
- Browser camera permissions and Quest passthrough access are different capabilities; XR composited passthrough pixels are not generally available as a JavaScript screenshot.

See [`changelog.json`](changelog.json) for version history, the [public project overview](../README.md) for judges, and [ABOUT.md](../ABOUT.md) for the story behind the project.
