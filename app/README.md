# FREE-LAB.cam

**Your world. Your agency.**

FREE-LAB.cam is a browser-based mixed-reality experience for exploring the things around us and experimenting with attention, coordination, and creative problem-solving. It brings a personal spatial archive and ten playful XR activities into one experience.

**[▶ Watch the 3-minute project film](https://youtu.be/rJ0nFm7jKms)** · **[Try the live demo](https://free-lab.cam/)** · **[Read our project story](ABOUT.md)**

[![Watch FREE-LAB.cam — a three-minute walk through our mixed-reality world](https://img.youtube.com/vi/rJ0nFm7jKms/hqdefault.jpg)](https://youtu.be/rJ0nFm7jKms)

> Built for Meta Quest Browser with WebXR; the desktop and mobile interfaces make the collection, settings, and activity history accessible without a headset. Not a clinical or medical application.

## Two sides of one experience

| **MY STUFF** · Explore the world | **AGENCY** · Explore what you can do |
| --- | --- |
| Capture and organize discoveries, photographs, and objects. | Choose from ten mixed-reality activities, from guided tasks to free play. |
| Browse sources and segments, search by voice or keyboard, and filter collections. | Use tracked hands or Meta Quest controllers to point, pinch, move, draw, sort, and play. |
| Open spatial galleries, cinematic image previews, an experimental Sphere Mosaic, and 3D models. | Explore shapes, numbers, colours, spatial coordination, and playful creative interaction. |

The two experiences complement each other: **My Stuff** turns observations into a personal universe; **Agency** invites intentional interaction. The “two hemispheres” idea is a metaphor for the experience, not a claim about how the human brain is divided.

### Ten Agency activities

| Activity | Explore |
| --- | --- |
| Shape Garden | Visual matching and shapes |
| Number Flow | Numbers and problem-solving |
| Hand Harmony | Left/right responses and coordination |
| Spatial Frames | Arranging and exploring spatial frames |
| Shape Sort | Classifying and sorting shapes |
| Chain Lab | Connecting and sequencing |
| Cube Lab | Building and interacting with cubes |
| Throw Lab | Throwing objects toward spatial targets |
| Five Note | Finger-based musical and rhythmic exploration |
| Thumb String | Colourful strings and finger gestures |

Some games offer free play; structured modes record attempts, accuracy, and elapsed time. Performance summaries are descriptive, **not medical diagnoses or evidence of improved cognitive health**.

## Try it

**Meta Quest 3 / Quest Browser:**

1. Open **https://free-lab.cam/** in Meta Quest Browser and sign in.
2. Choose **My Stuff** to explore the spatial collection, or **Agency** to choose an activity.
3. Enter XR and interact using either Touch controllers or tracked hands. Grant microphone or camera permission only when prompted for a feature that needs it.
4. Explore **Play & Progress** to review your recorded activity.

**Desktop or mobile:** Open the same [live demo](https://free-lab.cam/) to access the browser interface, personal content, progress, rooms, and configuration. Immersive passthrough and full XR hand interactions require compatible headset hardware and browser support.

**See it first:** [Watch the hackathon video on YouTube](https://youtu.be/rJ0nFm7jKms).

## Highlights

- **Spatial personal collection:** Searchable source images and segments, account-scoped galleries, 3D objects, voice search, and lightweight image thumbnails.
- **Mixed-reality interaction:** WebXR passthrough on Meta Quest; controller rays, trigger/grip, tracked hands, and hand pinch.
- **Spatial activities:** Ten activities, free and structured modes, colourful 3D visual feedback, and streaming HOW TO PLAY explainers when the corresponding media is published.
- **Play & Progress:** Session history, time spent, attempts, scores, response patterns, and left/right hand or controller comparisons. An optional experimental AI analyser describes aggregate trends with explicit consent.
- **Shared spatial rooms:** Public and private rooms and personal avatars, with capabilities depending on browser and server configuration.
- **Across devices:** Quest XR plus desktop/mobile browser views.

## Technology

| Layer | Implementation |
| --- | --- |
| XR / interaction | WebXR, Meta Quest Browser, JavaScript, WebGL, Three.js, hand tracking, controllers |
| Frontend | Browser UI, spatial galleries, custom XR rendering, video textures, HLS explainers |
| Backend | Python, Flask, SQLite, private per-user assets and progress data |
| 3D workflows | GLB models, Blender-based processing, browser-side rendering fallback |
| Optional services | Configured image/3D/voice providers; optional Meta AI commentary and ElevenLabs speech |
| Operations | Versioned ZIP releases, SHA-256 manifest checks, watcher-driven validation and deployment |

The live demo may need a user account and optional provider credentials. AI generation and speech services can involve usage costs; their availability is not required for every core activity.

## Privacy, limitations, and research integrity

- Personal captures and user records are account-scoped. Public rooms and shared content are separate from private collection data.
- Optional inference features require explicit user action; progress commentary is opt-in and uses aggregates, not raw personal captures. Review the application's controls before sending data to an external provider.
- **Quest passthrough is not automatically a camera image accessible to JavaScript.** Spatial Frames can capture from a separately permissioned, readable camera stream where supported; results vary by device and browser.
- Activity metrics are exploratory, task-dependent, and sensitive to practice, difficulty, and sample size. **FREE-LAB.cam is not a clinically validated cognitive assessment or rehabilitation tool.** Research claims require external validation.
- Device-specific graphics, camera capture, 3D models, and optional model APIs depend on the headset, network, permissions, and server configuration.

## Development and deployment

Repository layout (within the application root):

```text
README.md             Project overview, demo and getting started
ABOUT.md              Inspiration, project story and research direction
frontend/             Browser UI, WebXR scenes and game interactions
backend/              Flask API, data access and optional services
deploy/               Server installation and release management
requirements.txt      Python dependencies
tests/                 Regression checks
version.json          Current release version
changelog.json        Release notes and full version history
```

Local development (from the application root; use only for development):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m unittest discover -s tests
python -m flask --app backend.app run --debug
```

For the maintained deployment workflow, place a complete `FREE_LAB_RELEASE_vX.Y.Z.zip` in the watcher's `updates/` directory. The bundled `watch-free-lab.sh` validates the manifest, checksums, syntax, tests, and remote readiness. Use `./watch-free-lab.sh --dry-run` to validate without deploying. Server configuration and credentials belong outside versioned code (for example `/etc/free-lab.env`).

Explainer videos are **persistent static assets**, not part of release ZIPs. Each activity can read `/videos/<activity>/video_hls/index.m3u8` (with adjacent HLS segments) or fall back to `video.mp4`. Publish the repository's `videos/` tree independently using `./watch-free-lab.sh --sync-videos`. Updating those media assets does not require a software release.

For past changes, see [changelog.json](changelog.json). The application is evolving; consult the live demo for current device-specific behavior.

## Project story and next steps

See **[ABOUT.md](ABOUT.md)** for the inspiration, design choices, lessons learned, challenges, and future cognitive-science research direction. The core question remains: **Can technology help us become more active participants in the world around us?**

**FREE-LAB.cam — My Stuff. My Agency. My World.**
