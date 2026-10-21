# Gauntlet prompts

The two prompts behind the **visual quality** and **gauntlet speed** sections of the [model report](https://myllmbox.com/).
Each is sent as a single user message, exactly as below, with thinking on. Every run renders its answer's HTML in a browser
and judges what is drawn.

## Request settings

| setting | value |
|---|---|
| temperature | 1.0 |
| top-p | 0.95 |
| max_tokens | 70,000 |
| thinking | on (`"chat_template_kwargs": {"enable_thinking": true}`) |
| requests | one at a time (c = 1) |

Each request appends `\n\n(request id <unique id>, answer fully)` to the prompt, so no two requests share a cached prefix.

## Pasture

```text
Generate a single self-contained HTML file (HTML + inline CSS + inline JavaScript,
no external assets, no CDN imports, no fetch calls) that renders an animated
pasture scene with bouncing animals, made entirely from SVG primitives.

HARD REQUIREMENTS — implement ALL of them:

CANVAS
- Full-viewport SVG (100vw x 100vh), no scrollbars.
- A sky gradient background (light blue at top, transitioning to lighter
  blue/white near the horizon) covering the upper ~65% of the viewport.
- A grass area (green, optionally with subtle texture or gradient) covering
  the lower ~35%, with a clear horizon line where they meet.

SUN
- A yellow circle in the upper portion of the sky.
- Surrounded by a lighter yellow halo / glow.
- At least 6 ray lines or triangles emanating outward from the sun.

CLOUDS
- At least 3 clouds drifting slowly across the sky from one side to the other.
- Each cloud is constructed from 3+ overlapping circles or ellipses
  (white or off-white) — NOT a single shape.
- Clouds wrap around: when a cloud exits one side, it reappears on the other.

TREES
- At least 2 trees rooted firmly on the grass (NOT floating in the sky
  or buried in the ground).
- Each tree has:
    * A brown trunk (rectangle or tapered shape).
    * A green canopy (cluster of overlapping circles, or a single large
      shape — your choice, but it must look tree-like, not a green blob
      on a brown stick).
- Trees may sway gently OR remain static — your choice.

ANIMALS — exactly 4 distinct species, all visible at once:

For each animal you must construct it from SVG primitives only. NO emoji,
NO Unicode characters as graphics, NO external images. Each animal must be
RECOGNIZABLE as its species WITHOUT a text label — i.e. a person glancing
at the scene should be able to say "that's a sheep, that's a cow."

Required species and their non-negotiable identifying features:

  COW
    - Body: white/cream with at least 3 black patches/spots.
    - Exactly 4 legs visible (this is critical — count them).
    - 2 horns or 2 small ears on the head.
    - 2 eyes.
    - A pink udder OR a pink nose (cow-defining feature).

  SHEEP
    - Body: fluffy white (use multiple overlapping circles/ellipses to
      suggest wool — NOT a single smooth oval).
    - Exactly 4 dark legs visible.
    - A dark face (gray or black).
    - 2 eyes.
    - 2 ears.

  PIG
    - Body: pink, mostly oval/round.
    - Exactly 4 legs visible.
    - Pink snout (a small oval at the front of the face) with 2 nostrils.
    - 2 small triangular ears.
    - 2 eyes.
    - A small curly tail (a curved path).

  HORSE
    - Body: brown, longer than tall.
    - Exactly 4 legs visible (longer than the cow/sheep/pig legs).
    - Long neck.
    - Visible mane (darker line/shape along the neck).
    - 2 ears.
    - 2 eyes.
    - A tail at the rear.

GENERAL ANIMAL RULES (apply to all 4):
- All 4 animals must be drawn standing on the grass, not floating.
- Animals must be roughly proportional to each other (a horse is not the
  same size as a pig).
- No overlapping animals on top of each other; spaced across the field.
- Each animal must have a clearly visible head/face turned toward the
  viewer or in profile.

ANIMATION
- All 4 animals must "bounce" in place — a gentle vertical hop loop
  (e.g., 0.5–1 second period, ~10–20 px amplitude). They do not
  translate horizontally.
- Each animal's bounce should be slightly out of phase with the others
  (offset start times) so they don't all bounce in sync.
- Bouncing uses CSS keyframe animations or SMIL `<animate>` — your choice.
- Clouds drift continuously as specified above.

CONSTRAINTS
- Single file. No <link>, no <script src=...>, no fetch, no network access.
- No emoji, no Unicode pictographs (🐄🐷🐎🐑 etc.), no foreignObject text
  used as graphics. Animals must be SVG primitives only.
- No external fonts; system stack is fine for any text (e.g. labels are
  not required, but if you add them, system fonts only).
- Total file size under 30 KB.
- No console errors on load.

OUTPUT FORMAT
- Return ONLY the contents of the .html file, starting with <!DOCTYPE html>.
- No markdown fences, no commentary before or after.
```

## Fish

```text
Generate a single self-contained HTML file (HTML + inline CSS + inline JavaScript,
no external assets, no CDN imports, no fetch calls) that renders an animated
underwater scene constructed entirely from SVG primitives.

HARD REQUIREMENTS — implement ALL of them:

CANVAS
- Full-viewport SVG (100vw x 100vh), no scrollbars.
- Water gradient background: lighter blue near the top, darker blue near
  the bottom (linearGradient).
- A sandy or rocky seafloor along the bottom (~10–15% of viewport),
  in tan/beige/brown.

FISH — exactly 2 fish, visibly different from each other:

Each fish must be constructed from SVG primitives only. NO emoji, NO
Unicode characters as graphics, NO external images. Each fish must be
RECOGNIZABLE as a fish without a text label.

Required features for EACH fish:
- A body (oval, ellipse, teardrop, or simple shape).
- A triangular tail at the rear.
- At least 1 fin (top dorsal fin OR side fin OR both).
- Exactly 1 visible eye (circle with a pupil dot).
- A mouth indication (small line, curve, or open shape).

The two fish must be visually distinct:
- Different colors.
- Different sizes (one clearly larger than the other).
- Different overall body shape (e.g., one round/short, one long/slender).

BUBBLES
- At least 5 bubbles rising from somewhere on the seafloor.
- Each bubble is a small circle (white or light-blue, with optional
  highlight ring for sphericality).
- Bubbles drift upward continuously.
- When a bubble reaches the top of the viewport, it disappears and a
  new bubble respawns near the seafloor (continuous loop).
- Bubbles vary in size; smaller bubbles may rise faster.

SEAWEED / PLANTS
- At least 2 seaweed shapes rooted on the seafloor.
- Each seaweed is a green vertical wavy path or a stack of overlapping
  ellipses suggesting a plant.
- Seaweed may sway gently OR remain static — your choice.

ANIMATION
- Both fish must swim horizontally across the screen.
- Each fish must move at a noticeably different speed from the other.
- When a fish exits one side of the screen, it must reappear on the
  opposite side (wrap-around).
- Bubbles rise continuously as specified above.

CONSTRAINTS
- Single file. No <link>, no <script src=...>, no fetch, no network.
- No emoji, no Unicode pictographs (🐟🐠 etc.).
- All fish, bubbles, and seaweed must be SVG primitives only.
- Total file size under 18 KB.
- No console errors on load.

OUTPUT FORMAT
- Return ONLY the contents of the .html file, starting with <!DOCTYPE html>.
- No markdown fences, no commentary before or after.
```
