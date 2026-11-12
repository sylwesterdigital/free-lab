# FREELAB — Spatial Collector v0.7.0

Self-hosted Quest 3 WebXR experiment served at https://free-lab.cam/. Deploy the only ZIP `FREE_LAB_RELEASE_v0.7.0.zip` by dropping it into the existing watcher’s `updates/` directory; the macOS watcher v0.4.1 remains unchanged and is bundled inside the release only because its checksum is part of the release contract.

## First use

1. Sign in, test the Quest environment camera and look at the live feed. Passthrough visible through the headset does **not** imply camera pixels are available to web pages; an uploaded JPEG remains a fallback.
2. For voice prompting, use **Enable mic** near the mascot **before Enter XR**. Grant the microphone permission; no sound is recorded or uploaded at that time. The stream is kept alive for the immersive session.
3. Enter XR. Use the compact toolbar, controller trigger/grip, or hand pinch. The central eye is now half size. Camera capture plays a short procedural shutter sound.
4. Tap **Extract** on the source to run one user-triggered Meta recognition request. Image crops expand around the real capture. The original stays in place. Model results can be empty; open **LOG** to inspect the status and HTTP error. Source object crops are rectangular rather than decoded SAM transparent masks.
5. Select a photo, choose **Restore** to prefill an image-restoration prompt, or choose **Prompt** for an arbitrary instruction. The source remains saved and every generated result becomes a child. **Apply** is the only trigger for the paid image-edit request.
6. Speak an instruction through **SPEAK** (one paid speech-transcription request), or use **TYPE** to focus Quest Browser's native system keyboard *without ending XR*. Quest Browser 26.1+ is required for system keyboard integration; if not supported, the session stays active and displays an explanation. Keep the headset software updated.
7. Saying “Find my backpack”, “Where is my backpack?”, or “Highlight the backpack” searches labeled images in your private local collection and sparkles matching cards. Searches don't re-infer photo contents or know where an unrecognized object is in the physical room.
8. Select any two images (even source photos), press **MIX** after each or drop on the MIX target while dragging, then provide a composition instruction. This uses the same Meta Muse Image model; only **APPLY** sends a chargeable request. Mixer references are checked for profile ownership on the server.
9. Tap the X on a card to close it spatially without deleting it. Bin an object to privatize it, or Bin a source capture to hide the whole capture; the Bin gallery can restore both. Binning uses a generated paper-crumple sound.
10. **Settings** has browser-local toggles for the small pointer mascot, optional spoken status feedback and playful commentary. Speech output is provided by the browser and is not guaranteed on every headset build.

## Model routing, privacy and cost

The interface uses action names; model routing stays internal: Meta Muse Ember/Spark for understanding, SAM for region segmentation, Muse Image for image restoration/mixing, and Muse Voice Transcribe for speech recognition. Request budgets and cooldowns are configured by `/etc/free-lab.env` on Ubuntu. A zero limit means unlimited requests in the current code but **not** unlimited spending at Meta. No call is made until explicit user action. Camera and mic permissions remain controlled by the browser and OS.

Admin-only `/api/admin/diagnostics` reports a rolling window of HTTP paths/status codes/durations in **the current Flask worker process**. Request payloads, prompt text, camera images, bearer keys and provider responses are not logged there. The immersive LOG view also shows client-side errors. It is diagnostic metadata, not a full centralized server journal. Usage and billing data are separate from logs.

Credentials saved to the server remain encrypted with the existing `/etc/free-lab-vault.key` and persisted in SQLite. Back up the vault key and DB securely. The database migration is additive; this release does not reset captures or user profiles.

## Important limits

- A system keyboard in immersive XR requires the Quest Browser's `XRSession.isSystemKeyboardSupported`; older browsers will show a warning without exiting XR. If microphone permission has not been pre-granted, use the preflight control outside XR. An in-XR microphone dialog may be blocked or interrupt the session on specific firmware builds.
- Current XR image cards are 2D photos in world-space, not real occlusion-accurate meshes or persistent world anchors. The optional floating mascot is an original 2D sprite matching the landing character, not an imported Three.js rig.
- Voice "find" matches text labels/descriptions already in the private collection. It is not live object localization and may require an Extract request first.
- Image restoration is generative enhancement, **not a guaranteed pixel-perfect super-resolution algorithm**. Mix produces one generated child image and uses paid inference when Apply is pressed.
- Live Quest mic, system keyboard, haptics, camera permissions and provider returns must be validated on the physical headset; automated smoke testing cannot prove browser permissions or real-world camera access.
- The landing still loads pinned Three.js from a CDN with a CSS mascot fallback; full offline vendoring remains a separate task.

## Diagnostics and release validation

`./watch-free-lab.sh --dry-run` from the repo root validates manifests and runs Python/JS checks before deployment. The existing watcher runs continuously and processes `updates/FREE_LAB_RELEASE_v0.7.0.zip`; do not replace it.

Official references: https://developers.meta.com/vr/documentation/web/webxr-keyboard/ and https://dev.meta.ai/docs/image-generation
