# About FREE-LAB.cam

**My Stuff. My Agency. My World.**

[Watch the 3-minute film](https://youtu.be/rJ0nFm7jKms) · [Explore the live application](https://free-lab.cam/) · [Back to README](README.md)

## The idea: a walk in the park

Picture a cold, windy, surprisingly sunny autumn day. People are jogging. Dogs are walking their humans. Clouds drift overhead, and fallen logs look like strange prehistoric creatures. The park is a collection of movement, memories, and distractions.

FREE-LAB.cam grew from a simple question: **What if mixed reality could help us engage more actively with that world instead of escaping it?**

The answer took two complementary forms. **My Stuff** lets us capture, collect, and re-examine the world around us. **Agency** invites us to turn our attention toward what we can do: recognize, think, coordinate, persist, and create. They are two sides of the experience, not a literal claim about left-brain and right-brain abilities.

There's also room for imagination. Jenny, our imaginary ginger-haired workout-loving friend, is part of the film's playful framing: sometimes physical exercise isn't what we feel like doing. A few minutes spent playing with attention and coordination can still be an interesting alternative. Whether that leaves us more free is a question, not a claim.

## What we built

FREE-LAB.cam is a WebXR experience for Meta Quest Browser, with accompanying desktop and mobile browser interfaces.

**My Stuff** is a personal spatial archive: sources, segmented objects, search, collections, spatial image cards, cinematic previews, an experimental Sphere Mosaic, and 3D object workflows. Photos become material for discovery and interaction.

**Cognitive Agency** offers ten activities across free and structured play. They include numbers, matching, sorting, shape creation, throwing, cubes, strings, and finger-based interactions. Users interact through tracked hands or Meta Quest controllers.

**Play & Progress** records descriptive measurements such as session time, attempts, accuracy, response intervals, and left/right input. Optional AI observations can summarize aggregate performance after explicit consent. Progress reports are not diagnoses or proof of cognitive improvement.

The platform also explores spatial rooms, avatars, voice and XR video explainers.

## How we built it

The experience uses **WebXR, JavaScript, Three.js, and WebGL** to put 3D surfaces and interaction systems into a physical space. **Python, Flask, and SQLite** support authenticated user content, activity records, and optional model-provider workflows. Blender and browser-side 3D rendering support asset previews and thumbnails. Persistent HLS media supplies in-game explainers without bloating software releases.

Both hands and controllers support pointing, pinching, moving, drawing, and releasing, with custom world-space controls and feedback.

Versioned ZIPs, SHA-256 manifests, regression tests, and a deployment watcher protect releases.

## Challenges and lessons

**A spatial interface isn't a flat website.** Labels and buttons need the right depth, angle, size, hover feedback, and placement. Some interfaces must stay fixed in the room; others should turn toward the person interacting with them.

**Standalone XR performance matters.** 3D textures, decoded video frames, graphics state, and large source photographs can overwhelm a headset. We had to improve rendering paths, introduce lightweight thumbnails, and keep GPU resources under control.

**Natural interaction requires alternatives.** Hands are expressive, but not everyone wants to use gestures for every task. Controller support and browser access make the experience more flexible.

**Real-world assets are unpredictable.** Compressed GLB models and headless Blender environments introduced failure modes, leading to more explicit rendering states, diagnostics, and fallback preview approaches.

**Measurement needs humility.** A game can record scores and reaction intervals, but interpreting those numbers as changes in brain health would require careful research. We keep exploratory observations separate from clinical claims.

The biggest lesson: **Mixed reality becomes meaningful when it gives people more freedom to act, not just more digital things to look at.**

## Where it could go

Next: adaptive activities, shared spaces, richer progress trends, and privacy-conscious AI summaries. Collaborating with researchers in cognitive science and human-computer interaction could help determine which spatial tasks produce reliable measurements, how they vary with practice or difficulty, and what they might eventually be useful for.

That is a future research direction, not a medical promise.

For now, it begins with a walk in the park, an unexpected object, a few colourful shapes, and a playful mental workout.

**Do we feel more free? Who knows. But we had fun finding out.**

**FREE-LAB.cam — Your World. Your Agency.**
