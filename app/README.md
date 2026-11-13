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


## v0.8.0 — spatial transforms and image-to-3D

- Enter XR, turn and walk: navigation follows with inertia. Pin preserves room position but keeps its menu upright and user-facing. Grab its header to offset it. The eye follows separately at a slower rate.
- Captured photos open at the current headset position (separate from navigation). Select an image for the rotating Extract / Restore / Prompt / 3D / Mix / Folder / Bin actions attached directly beneath it.
- Tracked hands display a real WebXR joint-point skeleton when joints are exposed by Quest Browser; controller and hand rays still work. `depth-sensing` is optional and its availability appears in the XR Log. **Actual environment-depth occlusion and photoreal hand meshes are not implemented in v0.8.0.**
- To generate a 3D model: add a Meshy API key under Admin → Model Connections; select a saved photo or object in XR → 3D → Generate 3D (paid confirmation). The private image is passed as a data URI, not published. Polling is read-only. Completed GLB downloads and credits are listed in Collection → Your 3D Models. Signed asset links expire and can be refreshed. No GLB rendering inside XR yet.
- Existing profiles, encrypted keys, SQLite collections, and configured request quotas remain unchanged. The existing ZIP watcher requires no replacement.

## v0.9.0 — one menu, 3D mascot, gestures and watcher colours

- Source images: top-left **EXTRACT** badge triggers Muse for that photo, top-right **···** toggles a single vertical menu attached to the image. No always-visible duplicate image toolbars.
- Restore is an explicit paid one-click Meta image edit. Prompt opens Quest input; Enter submits the paid request. Voice transcripts appear in a small floating head-proximal status banner.
- 3D generation is a paid, explicitly confirmed Meshy task; progress and GLB URL live in personal Collection. Submission returns a task ID; the XR renderer remains responsive while the provider works.
- Configurable **3D / 2D / Off** XR mascot. The 3D version consists of shaded meshes in native WebGL, not the landing Three.js asset. Gesture classification uses tracked WebXR joint geometry and can be wrong; it is not an ML pose model. The idle bounce is in a virtual volume, NOT physical room-wall detection.
- No environment-depth occlusion. Current Quest WebXR support must be feature-detected; hand tracking does not imply depth sensing.
- The watcher is included as v0.9.0 and self-installs after a successful release. Restart the currently running watcher once to see its new colored and silent-idle terminal behavior.

## v0.9.2 — reliable XR image controls and mascot gesture feedback

Press/release gestures on image-card Extract / … / × are latched at press time and cannot turn into a move/rotate action. Hitboxes follow the 600-pixel texture layout and the actual height of each image. Gesture classification now causes only a brief speech label at the mascot and optional speech synthesis, with cooldowns; dictation status continues to work normally. The watcher is unchanged from 0.9.0.

### v0.9.2 voice and spatial controls

The XR voice microphone records up to 12 seconds, transcribes once, then shows the full recognized text and separate OK/Cancel roundels. Accepting a Find command searches locally; accepting image instruction sends a billed edit with the selected card. The body of the audio is not stored by the application. Camera permission remains dependent on Quest Browser. Pinned navigation remains fixed in position and orientation. No watcher change.

## v0.9.3 — String Lab (experimental)

In immersive XR, click the **right controller thumbstick** to toggle the lab. If the headset stops exposing that controller after switching to bare hands, the lab stays enabled. Bring both tracked thumb tips within approximately 5 cm for 160 ms; pulling apart creates a coloured musical string. Its tone increases from roughly 95 Hz to 635 Hz across 0–1 metre. At 1 metre it breaks with a procedural sound and falling fragments. The hands must separate at least 10.5 cm before they can start a new string. To turn the mode off, click the right thumbstick again while it is tracked (or exit the XR session).

This uses tracked thumb-tip joints and runs locally. It does not require camera pixel access, inference credentials or network requests. Because Quest may prefer either controllers or bare hands, verify that both hand `XRInputSource` objects are available after enabling the mode. The 3D break and floor motion are stylised rather than a physics engine; real-world occlusion is not implemented. Browser audio may require the first gesture to unlock the AudioContext.

## v0.9.4 — Five-Finger Chord Lab (experimental)

With WebXR active, click **left controller thumbstick** to toggle the independent Five-Finger Chord Lab. Put down controllers if Quest switches input modalities, then bring matching fingertips of both tracked hands together to form up to five independent coloured strings. Left/right thumb gives C4, index D4, middle E4, ring F4, and pinky G4. Each string bends upward in pitch and changes colour as stretched, snaps at its individual randomized threshold (~0.66–1.0 m), and plays a quiet A4 snap sound. Fragments fall and fade. Separate and re-touch to rearm. Press the **right** thumbstick to switch to the original thumb-only String Lab.

All processing stays on-device, no cloud inference. Quest Browser may temporarily stop exposing controller data when switching to hand tracking: toggle with controllers *before* starting hand gestures. No guaranteed hardware compatibility without physical Quest tests. Five-string polyphony is intentionally quiet.


## v0.9.5 — Stable spatial strings (rendering hotfix)

Both the original right-thumbstick String Lab and left-thumbstick Five-Finger Chord Lab now draw **one continuous triangle strip per active string**, instead of separate overlapping quads for each segment plus a co-planar glow overlay. A single fragment shader supplies the luminous centre and fading glow; transparent strings do not write into the depth buffer, avoiding the flickering green rectangles observed on Quest 3. Smooth miter joins share their vertices, with bounded thickness at sharp bends and a stable camera-facing fallback. Music, colours, break thresholds, and gestures are unchanged. No server/data migrations or new inference costs. Validate on Quest hardware after the v0.9.5 upgrade.


### Experimental Mode Selector (0.9.6)

In immersive WebXR, hold the **left controller thumbstick (L3)** to show a small controller-following dark mode pill. Tilt left or right (return to centre between steps) to highlight **Frames**, **Five Strings**, **Two Thumbs** or **Off**; release L3 to apply. Switching modes stops the preceding audio voices but does not remove previously placed spatial frames.

**Frames:** With both hands tracked, bring left/right index fingertips together and left/right thumb tips together. Slowly separate your hands while maintaining a frame at least 13 cm wide and 4.5 cm high. Hold for the configured 1.5, 3 or 5 seconds, then the rectangular outline becomes independent of the hands in the current WebXR reference space. Repeat to place more (up to 32 per session). Frames are session-only; exiting XR clears them. Requires environment hand tracking, and some Quest builds require putting down controllers for hand tracking to activate. This lab runs locally without any inference charge.

### v0.9.7 XR camera and Extract fix
The three spatial roundels are always present. Extract is dim until an active source photo is visible. The optional camera feed preview floats 24.5 cm above the eye, not over the Extract button, and disappears after capture. Segmentation still requires a user-triggered paid recognition request.

### v0.9.9 – Capture and AI extraction correction
The immersive camera preview was removed. The eye requests permission when needed and captures on the next press. A capture is selectable for Extract only after `/api/captures` confirms its persistent ID; failure clears temporary `SAVING` state and exposes the error in XR diagnostics. The source card's top-left Extract button is visible for saved frames.

**Inference limits are disabled by default**. The installer no longer imposes 24/8 requests. On an existing server, old `FREE_LAB_DAILY_LIMIT` values are ignored unless `FREE_LAB_ENFORCE_INFERENCE_LIMITS=1` is explicitly configured. Optional `FREE_LAB_DAILY_LIMIT`, `FREE_LAB_USER_DAILY_LIMIT`, `FREE_LAB_COOLDOWN_SECONDS` may be configured by the operator. Provider-level spend and rate limits still apply. No dollar hard cap is claimed.


## v0.10.2 · XR workbench

The selected image provides one contextual popover: EXTRACT, DESCRIBE, REFINE, PROMPT, VOICE, 3D. The XR microphone is press-to-record / press-to-stop (up to 90 seconds for the server upload safety limit), with a live frequency ring and user-confirmed transcript. DESCRIBE explicitly calls Meta vision once and caches the private description for subsequent views. Sound preference defaults to browser speech; ElevenLabs TTS is strictly opt-in with an encrypted server-side API key.

The LOG window is moveable and resizable independently of the navigation. 3D generation is an asynchronous, explicitly confirmed Meshy paid job: status is polled and displayed in XR. When ready, a small untextured triangle-only preview is decoded from eligible GLB v2 content (12 MB server download ceiling; max 3,600 preview triangles). Some provider-compressed GLB formats cannot be previewed and remain downloadable from LIB. No free claim about Meshy inference is made. The preview never uploads additional photographs.

For images outside Quest, upload via the camera panel and use **Save photo to Spatial Library**. Open LIB in XR to view the capture and use Extract. No new quotas are introduced.

## v0.10.2 · XR scene and provider hotfix

- 3D provider is explicitly selected per profile under Admin → Model Connections. Aholo Lux3D is preferred when an Aholo key exists; Meshy is not a silent fallback. Aholo uses a signed, two-hour-lifetime image URL sent to Aholo on the paid task. The full resulting GLB is available from the Library; geometry preview is best-effort.
- DESCRIBE uses a paid Meta vision request on the actual image (not the image-refine prompt). Private follow-up conversations are stored in `image_dialogue`; editing metadata remains untouched.
- In XR, Library pages include historic captures (within the existing 500-result server query); the client shows 8 per page. Darkroom, camera-pitch billboarding, slow mascot orbit and manual frame manipulation are local-only.
- No new caps, no changes to the running ZIP watcher. Actual Quest Browser tracking and new Aholo generation need device/API testing.

## v0.10.2 · spatial interaction refinement

Status fades without typewriter audio or independent drift. Spatial experimental frames rotate with a grabbing hand using wrist orientation and a fixed index-fingertip contact offset. The mascot banks into travel and displays a larger, animated speech bubble. No watcher, backend, or quota changes.


## v0.10.3 — immersive cinema and interaction reliability

- Cinema: opaque black WebXR stereo frame, image at approximately 2.35 m, head-aligned pitch/yaw, large X exit, subtle simulated glossy floor. No loss of the immersive session.
- Clear status: short, muted green, one line beneath camera hint. Microphone silence says “No speech” once.
- Vision: DESCRIBE always makes an explicit Meta Spark image-analysis call, stores the result privately and shows actual error diagnostics if it fails. **This action is billable.**
- Mascot: head-first directional swimming, open-palm approach, fist/forward escape and two-ray avoidance. Gesture recognition remains experimental.
- No watcher changes or application request quotas.

### v0.10.6 Meta image descriptions
DESCRIBE uses `POST /v1/responses` with a private JPEG as a `user` `input_image` data URL and a concise `input_text` instruction. Responses `output` message text is parsed and usage retained; reasoning items are not displayed. Meta 503 retries remain bounded, with provider error code and request ID exposed without image data or secrets. This integration is locally mocked and must be tested with actual credentials on Ubuntu.

## Recursive image tree (v0.10.6)

Every saved capture is the root of a tree. Extract, SAM segmentation, and Muse Image edits
can use any saved child object at any depth. Parent relationships are stored as `parent_object_id`
within the same private capture. The XR scene displays **seven direct children per page**
to protect Quest rendering; that number is **not a storage, inference, or tree-depth limit**.
Open an object menu (`··· → OPEN BRANCH`) to see that object's children; use the
`PARENT`, `PREVIOUS`, and `NEXT` spatial cards to navigate without making AI calls.

Nested operations bill according to the selected model; browsing an existing tree does not.


## v0.10.7 Experimental Physics Games
Hold the left controller thumbstick, tilt to select FRAME, CHAIN, CUBES, THROW, FIVE STRINGS, THUMBS, OFF; release to activate. Draw a frame by joining both pairs of thumb/index fingertips, opening it, and holding for the configured frame-detach interval. CHAIN links two placed frames when a grabbed frame intersects another; a pendulum/hinge constraint lets a child swing as the parent moves. CUBES converts each completed frame into a shaded cuboid that drops onto a local-floor-based plane and stacks against previously placed cuboids. THROW lets a grabbed frame fly using fingertip velocity; it fades and disappears after about 1.6 seconds. Games work offline without model inference. Physics is a small bounded built-in solver for this experiment (not the Rapier WASM engine), with limited axis-aligned box collisions, max 22 cuboids and no environment mesh collisions.
