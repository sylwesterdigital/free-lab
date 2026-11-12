# FREELAB — Spatial Cloud v0.4.0

Self-hosted Quest 3 mixed-reality discovery MVP. Built for macOS M2 Pro development, Ubuntu serving, and browser-based WebXR. Domain: https://free-lab.cam/.

## What's new in 0.4.0 — spatial dandelion collector

In the browser on Quest 3, press the **XR** portal. There is no head-locked dashboard: the scene contains a world-locked photo and a minimal, borderless grey control pill floating near it. Input rays are visible when controllers or hands are detected. The world root is placed only once on session start or when you deliberately recenter.

**Spatial workflow:**

1. Before XR, choose **Test camera** and verify readable room pixels, or **Upload image** (when Quest Browser cannot obtain environment pixels). The XR passthrough display alone cannot be captured by JavaScript.
2. Enter XR and point to **+ CAPTURE**, pinch or pull the trigger. The image is saved as a private `captures` row and becomes a large spatial thumbnail; zero paid model calls. A cloud can also be revisited from **▣ LIB**.
3. Press **✦ MUSE** deliberately. A single paid Muse image request produces up to six labeled approximate boxes; actual cropped JPEGs bloom from the source on curved paths. This is **not** a pixel-accurate segmentation mask.
4. Select a recognized object thumbnail. Press **⌗ SAM** to make **one** charged SAM 3.1 request for that label; SAM's rectangular image regions appear as additional cards. Wait for the 20-second request cooldown enforced by the server. SAM's RLE masks are **not decoded** by this release.
5. Point and hold a controller trigger or hand pinch to **drag** a spatial card. Selecting an existing card again flips it to descriptive text. A miniature edit pill enables flip / smaller / larger. Its transform is saved to SQLite relative to its capture. **▤ FOLDER** cycles among Unsorted, Keep, Room and Objects; **⌫ BIN** moves a selected item to a private virtual Bin. During an active drag, temporary floating FOLDER/BIN drop targets appear for direct drop gestures. Without a selection, Bin opens a room-space restoration gallery.
6. **◌ HIDE** collapses the cloud with a short curved animation and luminous particles, then removes it from the active scene without deleting data. **▣ LIB** reopens saved captures; **+** begins another. **× EXIT** ends XR. Squeeze with no selection explicitly recenters the workspace.

### Data and privacy

- Existing SQLite DB, profiles, object images, encrypted provider vault and usage limits are preserved. New `captures` table and `objects.capture_id`, `folder`, `shelf`, `spatial_json` fields are added idempotently.
- Captures and their images require owner authentication. Up to 50 captures per user (each compressed JPEG under 450 KB). No spatial positions are transferred to the public model providers; only manually requested images are transmitted.
- Moving an object to Bin forces its visibility to private and revokes existing link shares. Gallery access remains profile-scoped; binning does not delete the associated image.
- The cards represent **2D images in a 3D room-space collection**, not a metric reconstruction of the real objects and not physical occlusion-accurate placement. World locking lasts for the current XR session, not across device reboots.
- The application-wide quota remains 24 total / 8 per profile per rolling 24 hours, 20-second cooldown, configurable in `/etc/free-lab.env`; not a hard dollar cap or Meta API spend cap.

**WebXR camera limitation:** some Quest Browser firmware only exposes avatar camera or refuses environment camera. Use the upload workflow; full optical passthrough access may require a separate native Quest capture companion. Never assume the headset compositor supplies image pixels for inference.

## Deploy from macOS

```bash
cd /Users/smielniczuk/Documents/works/free-lab
cp ~/Downloads/watch-free-lab-v0.4.0.sh ./watch-free-lab.sh
cp ~/Downloads/FREE_LAB_RELEASE_v0.4.0.zip ./uploads/
chmod +x ./watch-free-lab.sh
./watch-free-lab.sh --dry-run
./watch-free-lab.sh --once
```

The watcher validates source file hashes, archive safety, all required version markers, Python/JS syntax, and unittest checks before contacting GitHub/Ubuntu. It deploys via SSH `root@46.62.232.64:333` to `free-lab.cam`, then verifies public version/API health and pushes main. The watcher keeps older ZIPs untouched; highest version takes priority. Do not place passwords or keys in the repository/ZIP.

## Admin key vault

Sign in with your administrator account, open the small round account button at the top right, and select **Admin / model connections**. Choose Meta and paste the API key. Save. The key never appears in responses, console logs or static assets. Saved keys are encrypted before being written to `/var/lib/free-lab/free-lab.sqlite3`; the vault encryption key is `/etc/free-lab-vault.key` (root:free-lab, 0640), created only if absent. **Back up the DB and vault key together, securely and separately from your Git repository. If the vault key is lost, saved API credentials cannot be decrypted.** Environment `MODEL_API_KEY` is supported as a legacy fallback; it is never overwritten.

Other provider credentials can be securely saved and deleted by admin. **3D generation API calls are NOT integrated in v0.4.0**; storing a key does not automatically enable 3D reconstruction.

## Camera and costs

Quest WebXR `immersive-ar` passthrough is compositor output, not directly accessible camera pixels. `navigator.mediaDevices.getUserMedia()` may provide an environment camera when Horizon OS and Quest Browser permissions allow, but some firmware/browser combinations deny it. Explicitly start **Camera** or **Upload image**, then **Recognize** or **Find with SAM 3.1**. No model call is issued just from entering XR.

- Muse Ember is the low-cost default; Spark 1.3 is optional.
- SAM 3.1 accepts an image and a *single short noun phrase* such as `chair`, returns boxes and masks; this UI draws boxes only.
- Current limits: 24 total model requests per rolling day, 8 per profile, 20 seconds cooldown. All Muse/SAM requests share those caps. This is a request cap, NOT a hard spending cap.
- SAM 3.1 published image price: $2.50 / 1,000 images. Video: $0.20 / 1,000 frames with a minimum charge of 50 frames per video call. Verify pricing before larger tests.
- Opt-in 20-second scan only uses a camera stream exposed by the browser and visible to the page. If no stream is granted, it refuses to start.
- All saved images/inventory are private unless shared or explicitly published by their owner.

## Optional SAM video proof

Install `ffprobe` via FFmpeg on your development machine or server, create an MP4 at 5–10 fps containing no more than 100 total frames and at most 6 MB, and run this command in an environment with the Meta API key available:

```bash
python3 -m tools.sam_video_probe --file /path/to/short-clip.mp4 --prompt chair --dry-run
python3 -m tools.sam_video_probe --file /path/to/short-clip.mp4 --prompt chair --send
```

The CLI prints expected base SAM segmentation cost before any request. `--send` is explicit consent for paid upload/segmentation. On the server the script can read the encrypted Meta key via the service account's DB/key file permissions. SAM returns tracked objects by frame; the CLI currently exports bounding boxes only. Source clips are sent to Meta for inference, not hosted publicly. You can use `ffmpeg -i source.mp4 -t 4 -vf fps=10 -an -movflags +faststart short-clip.mp4` to reduce clip size.

## Roadmap / limitations

- **Not done yet:** decoded SAM pixel masks and true occlusion, multi-object SAM batching, continuous raw video stream into SAM, WebRTC multiplayer, world-anchored recognized object labels, true scene meshing, full decoded SAM masks, provider-specific 3D generation workflows, gesture vocabularies beyond point/select and pinch, or reliable shared spatial anchors.
- WebXR support for hand input and tracking varies with Quest Browser version. Plane detection/anchors are requested as optional browser features but are not yet consumed by the UI.
- Three.js enhanced landing scene currently imports the pinned Three.js r181 module over a public CDN on first visit. The WebXR HUD, API, SQLite, auth, and CSS mascot **do not require a CDN**. To run fully offline, vendor a verified copy of Three.js r181 `build/three.module.js` and `build/three.core.js` under `frontend/assets/vendor/`. Both files are required; the module imports its core sibling. Until then, the app is functional but the Three.js enhancement is not self-contained.
- No model inference has been executed in a paid Meta account or tested on a physical Quest by this packaging process. Verify the hosted app, permissions and prices in your environment.

## Relevant official documentation

- https://dev.meta.ai/docs/sam/overview
- https://dev.meta.ai/docs/sam/segmenting
- https://dev.meta.ai/docs/pricing-rate-limits
- https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/
- https://developers.meta.com/vr/support/investigations/1557993751977106/


### v0.4.1 Quest renderer fix
Fixed WebGL texture parameter arity; disabled multisample XR layer; removed an absent local Three.js import; nginx now returns 404 for nonexistent assets. The landing mascot uses pinned CDN Three.js with an offline CSS fallback. No account data or credentials are reset.
