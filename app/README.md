# FREELAB — Spatial Studio v0.3.0

Self-hosted Quest 3 mixed-reality discovery MVP. Built for macOS M2 Pro development, Ubuntu serving, and browser-based WebXR. Domain: https://free-lab.cam/.

## What's new in 0.3.0

- **Real world-locked XR UI**: the 3D panel is placed once using the viewer pose and thereafter rendered in a `local-floor` / `local` reference space; moving your head no longer moves the panel. The header can be moved using tracked input, and RECENTER brings it back in front of you. World locking is only maintained for a running session: this does NOT create a persistent spatial anchor across sessions.
- **Visible input**: WebXR controller and hand `targetRaySpace` laser pointers and hover cursors, plus select/trigger and thumb/index pinch fallback for hand tracking. Not a rendered hand mesh, full-body skeletal pose, or Horizon OS system menu replacement. Device/firmware runtime support must be verified on Quest 3.
- **Focused capture HUD in XR**: SNAPSHOT (local/free), MUSE (one charged recognition), SAM (one charged image segmentation), CHANGE OBJECT noun target, COLLECTION, RECENTER, EXIT. Entering XR never triggers inference. A browser camera stream must be live *before* entering; passthrough pixels are not automatically readable from WebXR.
- **Practical SAM collection**: save detected image bounding boxes as labeled private JPEG crops in the SQLite inventory; this is NOT decoded alpha-mask segmentation, 3D reconstruction, plane detection, or accurate world-space coordinates. Up to six crops per image request.
- **Admin provider keys**: Meta, Aholo Labs (Lux3D/world reconstruction), Meshy, Tripo, fal.ai, Replicate, OpenAI, Google Gemini, xAI/Grok Imagine. Per-provider selection uses custom pill buttons, not Quest Browser's oversized native menus.
- **Credential choices**: per tab in-memory JavaScript `Map` (cleared on refresh/logout) or encrypted server-side SQLite vault with its separate `/etc/free-lab-vault.key`. No localStorage/sessionStorage persistence. Temporary Meta key is transmitted to FREE LAB's server only for a deliberate request, never in HTML or URL.
- **Free-of-inference account checks**: fixed read-only endpoints for Meta, Aholo, Meshy, OpenAI, Gemini, xAI and Replicate. Aholo uses its documented *raw* Authorization header, not Bearer. Meshy exposes available credits; other providers generally do not expose a reliable account balance here. Tripo and fal.ai checks are disabled when no verified read-only endpoint is known. A provider may apply account-specific API usage policies; no generation calls are made.
- **Usage clarity**: FREE LAB's SQLite ledger tracks recent Muse/SAM requests and reported token counts; 24 global / 8 per profile per rolling 24 hours are local request quotas, not Meta billing caps. Change in `/etc/free-lab.env`, restart `free-lab.service`.
- **XR/camera diagnostics and native-free consent**: Test Camera and XR readiness display actual media track labels, video pixel resolution and supported XR session modes. Start-20s-scan confirmation is an in-app dialog.
- **Landing remains cinematic**: original 3D FREELAB mascot, dark spatial canvas and central XR portal with local fallback. Three.js r181 scene remains pinned to external CDN, so the project is not completely offline/self-contained yet.

**Known hardware/browser limit:** some Quest 3 Browser/OS versions do not grant `getUserMedia({video:{facingMode:'environment'}})` access to headset camera pixels; when permission is absent this release cannot infer objects from passthrough. Use the upload fallback to test recognition and SAM while addressing the camera path. WebXR headset passthrough by itself is display-only, not a video source.

## Deploy from macOS

```bash
cd /Users/smielniczuk/Documents/works/free-lab
cp ~/Downloads/watch-free-lab-v0.3.0.sh ./watch-free-lab.sh
cp ~/Downloads/FREE_LAB_RELEASE_v0.3.0.zip ./uploads/
chmod +x ./watch-free-lab.sh
./watch-free-lab.sh --dry-run
./watch-free-lab.sh --once
```

The watcher validates source file hashes, archive safety, all required version markers, Python/JS syntax, and unittest checks before contacting GitHub/Ubuntu. It deploys via SSH `root@46.62.232.64:333` to `free-lab.cam`, then verifies public version/API health and pushes main. The watcher keeps older ZIPs untouched; highest version takes priority. Do not place passwords or keys in the repository/ZIP.

## Admin key vault

Sign in with your administrator account, open the small round account button at the top right, and select **Admin / model connections**. Choose Meta and paste the API key. Save. The key never appears in responses, console logs or static assets. Saved keys are encrypted before being written to `/var/lib/free-lab/free-lab.sqlite3`; the vault encryption key is `/etc/free-lab-vault.key` (root:free-lab, 0640), created only if absent. **Back up the DB and vault key together, securely and separately from your Git repository. If the vault key is lost, saved API credentials cannot be decrypted.** Environment `MODEL_API_KEY` is supported as a legacy fallback; it is never overwritten.

Other provider credentials can be securely saved and deleted by admin. **3D generation API calls are NOT integrated in v0.3.0**; storing a key does not automatically enable 3D reconstruction.

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
