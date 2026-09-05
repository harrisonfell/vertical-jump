---
name: vertical-jump
description: A solo athlete's jump-training instrument. Paper by day, charcoal by night, one green.
---
<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->

# Design System: vertical-jump

## 1. Overview

**Creative North Star: "The Timing Board"**

The precision of an athletics timing display, brought to a coach's clipboard. Every screen is a sheet of tinted paper with ink on it: one sans-serif family, tabular figures, hairline rules, and a single deep green that does the work a highlighter does on a real training log. Nothing is a card. Depth comes from tone and rules, never from shadow. Charts follow lab-notebook discipline: direct labels, a dashed goal line, recovery drawn beside output at the same scale.

The system has exactly one loud moment: a personal record of 1.0 in or more (and, once per goal, the goal-reached card). Then the surface itself turns green and the number gets big. An ordinary test day stays on paper with the test block's header line in green, because twelve test days in twelve weeks cannot all be the loud moment. Every other day is quiet so that moment can be loud.

This system rejects, by the owner's decision, everything in the original Base44 prompt pack's styling: dark slate grounds, neon teal and amber, glow utilities, clipped tag shapes. It also rejects the generic fitness dashboard (hero metric banner, identical stat cards, motivation banner, confetti, share card), gym-bro aesthetics, and consumer-wellness softness. It was chosen from four generated direction probes; the timing-board probe won, with the two-tone probe's green block reserved for test day, the lab-notebook probe's chart rules kept for Progress, and the dark-instrument probe adopted as the night scheme. Serif numerals and gauge arcs were considered and rejected.

**Key Characteristics:**
- Light by default, because the primary scene is a bright gym with a wet phone. Dark scheme follows the system setting at night.
- One accent, deep green, at or under 10% of any daily surface.
- One type family. Tabular figures wherever digits appear.
- Hairlines and tone instead of borders, cards, and shadows.
- Charts are the analytics; they get the same care as type.

## 2. Colors: Paper, Charcoal, One Green

Tinted neutrals carry everything; a single green marks what matters today.

### Primary
- **Deep Green** (exact value to be resolved during implementation; OKLCH, hue family around 150 to 160, lightness roughly 35 to 42%, moderate chroma): the only accent. Used for the current selection, the checked row, the goal tick on a track, the primary action, today's marker on a chart, and the header line of the test block. At a PR of 1.0 in or more, and on the goal-reached card, it may carry the whole surface.

### Neutral
- **Paper** (to be resolved; light, chroma about 0.005 tinted toward the green hue): the daytime ground. Never pure white.
- **Ink** (to be resolved; near-black tinted toward the green hue): text and hairlines. Never pure black.
- **Charcoal** (to be resolved; warm near-black, no blue tint) and **Bone** (warm off-white): the night scheme's ground and text. Same structure, same green, re-tuned for contrast on dark.

### Data Palette
- Four training categories (Plyometrics, Strength, Mobility, Technique) and three recovery bands (low, moderate, high) get a small dedicated palette used only inside charts, chips, and glyphs. Values to be resolved during implementation. Each is always paired with a label or glyph.

### Named Rules
**The Restrained Rule.** On every daily surface, green is at or under 10%. Its rarity is what makes the checked row and the goal tick legible.

**The PR Exception.** A same-instrument personal record at or above that instrument's PR threshold (1.0 in by default, recalibrated from the device's own noise after three sessions), and the goal-reached card, may go committed: green carries 30 to 60% of the surface, with paper or bone text on it. This is the one place the system raises its voice. It never fires during the first three calibration sessions on a new instrument or on a stream change. An ordinary test result stays on paper; only the test block's header line takes the accent.

**The Data Palette Rule.** Category, day-type, and recovery colors never appear on UI chrome, buttons, or backgrounds, and never work alone. If a chip loses its color, its label still tells you everything.

**The Instrument Label Rule.** Every jump number and every chart series carries its instrument as text ("OVR Jump", "Vertec"). Two instruments never share an axis, a trend line, or a PR. Entry source (typed, imported, estimated) and calibration state are labels, not colors.

## 3. Typography

**Display Font:** the body family at heavy weight and large size (no separate display face)
**Body Font:** one sans-serif family with true tabular lining figures (to be chosen at implementation)
**Label/Mono Font:** none; labels are the body family in uppercase with tracking

**Character:** a technical sans that reads like an instrument readout, not a magazine. It must ship tabular figures, a real multiplication sign, and hold up at 11px labels and at 96px readouts alike.

### Hierarchy
- **Display** (heavy, the single big number on a screen, tight line-height): the current vertical, a test result, a PR. One per screen at most.
- **Headline** (semibold, roughly 1.4 to 1.6 times body): screen titles and block names ("Week 4 of 12 · Power block").
- **Title** (medium, roughly 1.15 to 1.25 times body): exercise names and section heads.
- **Body** (regular, 16px on phone, 65 to 75ch max for prose): descriptions, notes, coaching cues.
- **Label** (medium, 11 to 12px, uppercase, letter-spacing about 0.06em): eyebrows, axis labels, units.

### Named Rules
**The Tabular Rule.** Every number is set with tabular figures and right-aligned when it sits in a column. Prescriptions use the real multiplication sign and one format per row type: "5 × 205 lb", "8 × BW", "30 s hold", "15 m", "3 × 3 @ 0.75 to 1.00 m/s". Heights show one decimal, contact times whole milliseconds, velocities two decimals. No set row ever shows an exercise-level percentage.

**The One Big Number Rule.** A screen may make one number large. If two numbers compete for the display size, neither is the point.

## 4. Elevation

Flat. Surfaces sit at one level; hierarchy comes from type scale, tone (a second neutral a few percent darker or lighter for panels and the bottom bar), and hairline rules. Shadows are prohibited at rest. The only lifted objects are transient sheets and dialogs, which get a single soft ambient shadow so they read as temporary.

### Named Rules
**The Hairline Rule.** Separation is a 1px rule in the ink color at low opacity, or a change of tone. Never a border-radius-and-shadow card, never a colored side stripe.

## 6. Do's and Don'ts

### Do:
- **Do** keep every daily surface light paper with ink and one green; let the night scheme follow the system setting.
- **Do** set every digit in tabular figures and right-align numeric columns.
- **Do** draw charts with direct labels on points, a dashed goal line, labeled axes, and recovery aligned beside output at the same time scale.
- **Do** reserve the green-filled surface for a PR of 1.0 in or more and the goal-reached card. Nothing else earns it.
- **Do** pair every category and recovery color with a label or glyph.
- **Do** keep touch targets at 44px or larger on the session screen.

### Don't:
- **Don't** use the Base44 pack's look: dark slate ground, neon teal and amber accents, glow utilities, clipped tag shapes.
- **Don't** build the generic fitness dashboard: hero metric banner, a grid of identical stat cards, a motivation banner, a confetti modal, a shareable summary card.
- **Don't** use gym-bro aesthetics: aggressive display type, flame iconography, "beast mode" copy.
- **Don't** use consumer-wellness softness: pastel gradients, progress rings on everything, mascot energy, streak guilt.
- **Don't** use serif or decorative numerals, gauge arcs, or graph-paper textures; all three were tested in probes and rejected.
- **Don't** use shadows at rest, cards with borders and radius, or colored side stripes wider than 1px.
- **Don't** use pure #000 or #fff anywhere.
- **Don't** overlay two instruments on one axis, or show a PR across instruments.
- **Don't** show a single load or percentage for a whole exercise; every set carries its own.
- **Don't** put a glyph on plain answer rows (setup radios); glyph plus text is for day types, cell states, set states, and instruments.
- **Don't** animate for celebration; motion conveys state only, and respects reduced-motion.
