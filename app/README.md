# FREELAB — Spatial Studio v0.2.0

Self-hosted Quest 3 mixed-reality discovery MVP. Built for macOS M2 Pro development, Ubuntu serving, and browser-based WebXR. Domain: https://free-lab.cam/.

## What's new in 0.2.0

- Cinematic dark, progressively lit floor scene with a friendly original soft-body FREELAB creature, fluorescent green silhouette, buoyant ears, floating nameplate, and large XR portal.
- Three.js r181 enhanced renderer for desktop/Quest Browser when the pinned module can be fetched. Pure local CSS 3D-like mascot fallback works without CDN. See *Offline note* below.
- Small floating navigation; slide-out private collection; release-note overlay shown once per logged-in user per version.
- Movable WebXR UI: point at header and hold/pinch the bar to reposition; select/trigger on controls; squeeze for snapshot; hand tip pinch fallback; XR input count shown in HUD. Quest palm menu gestures remain managed by Horizon OS.
- Admin-only API key vault: Meta, Meshy, Tripo, fal.ai, Replicate. `cryptography.Fernet` encrypts key material before storage in SQLite, with the encryption key root-owned outside Git.
- Meta key saved in admin settings enables Muse image recognition and SAM 3.1 image probe. Models require a valid API key and are never silently called.
- Opt-in 20-second snapshot scan. Inference is limited by existing global and per-user rolling daily request limits and cooldowns. No guaranteed dollar cap.
- `/api/segment` returns SAM 3.1 image bounding boxes in pixel coordinates; masks are available from Meta but are NOT decoded in this build. No pretend 3D meshes.
- Offline/video CLI `tools/sam_video_probe.py` uploads an explicitly chosen short MP4 after checking the number of frames with ffprobe; converts SAM results into frame/box summaries (no mask decoding).

## Deploy from macOS

```bash
cd /Users/smielniczuk/Documents/works/free-lab
cp ~/Downloads/watch-free-lab-v0.2.0.sh ./watch-free-lab.sh
cp ~/Downloads/FREE_LAB_RELEASE_v0.2.0.zip ./uploads/
chmod +x ./watch-free-lab.sh
./watch-free-lab.sh --dry-run
./watch-free-lab.sh --once
```

The watcher validates source file hashes, archive safety, all required version markers, Python/JS syntax, and unittest checks before contacting GitHub/Ubuntu. It deploys via SSH `root@46.62.232.64:333` to `free-lab.cam`, then verifies public version/API health and pushes main. The watcher keeps older ZIPs untouched; highest version takes priority. Do not place passwords or keys in the repository/ZIP.

## Admin key vault

Sign in with your administrator account, open the small round account button at the top right, and select **Admin / model connections**. Choose Meta and paste the API key. Save. The key never appears in responses, console logs or static assets. Saved keys are encrypted before being written to `/var/lib/free-lab/free-lab.sqlite3`; the vault encryption key is `/etc/free-lab-vault.key` (root:free-lab, 0640), created only if absent. **Back up the DB and vault key together, securely and separately from your Git repository. If the vault key is lost, saved API credentials cannot be decrypted.** Environment `MODEL_API_KEY` is supported as a legacy fallback; it is never overwritten.

Other provider credentials can be securely saved and deleted by admin. **3D generation API calls are NOT integrated in v0.2.0**; storing a key does not automatically enable 3D reconstruction.

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

- **Not done yet:** continuous raw video stream into SAM, WebRTC multiplayer, world-anchored recognized object labels, true scene meshing, full decoded SAM masks, provider-specific 3D generation workflows, gesture vocabularies beyond point/select and pinch, or reliable shared spatial anchors.
- WebXR support for hand input and tracking varies with Quest Browser version. Plane detection/anchors are requested as optional browser features but are not yet consumed by the UI.
- Three.js enhanced landing scene currently imports the pinned Three.js r181 module over a public CDN on first visit. The WebXR HUD, API, SQLite, auth, and CSS mascot **do not require a CDN**. To run fully offline, vendor a verified copy of Three.js r181 `build/three.module.js` and `build/three.core.js` under `frontend/assets/vendor/`. Both files are required; the module imports its core sibling. Until then, the app is functional but the Three.js enhancement is not self-contained.
- No model inference has been executed in a paid Meta account or tested on a physical Quest by this packaging process. Verify the hosted app, permissions and prices in your environment.

## Relevant official documentation

- https://dev.meta.ai/docs/sam/overview
- https://dev.meta.ai/docs/sam/segmenting
- https://dev.meta.ai/docs/pricing-rate-limits
- https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/
- https://developers.meta.com/vr/support/investigations/1557993751977106/
