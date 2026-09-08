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

Authored in OKLCH in `apps/mobile/src/ui/tokens.oklch.ts`; `npm run tokens` converts to sRGB hex and fails the build on any contrast, tint, or colour-vision violation. React Native never sees the OKLCH.

### Primary
- **Deep Green** `oklch(42% 0.115 155)` → `#005e2f` light, `oklch(72% 0.12 155)` → `#60bb83` dark: the only accent. Used for the current selection, the checked row, the goal tick on a track, the primary action, today's marker on a chart, and the header line of the test block. 7.16:1 on paper, 7.76:1 on charcoal. At a PR of 1.0 in or more, and on the goal-reached card, it may carry the whole surface, with **onGreen** `#eff8f2` on it at 7.28:1.
- **Green Soft** `#c8e7d1` light, `#173523` dark: the quiet ground under a selected row or chip, always with the green mark still on it.

### Neutral
Every neutral is tinted toward the accent hue at chroma 0.005 to 0.01, asserted by the generator so it can never drift back to grey.
- **Paper** `oklch(96.5% 0.006 155)` → `#f0f5f2`: the daytime ground. Never pure white. Two tones follow it for panels and pressed rows: `#e5ece7` and `#dae2dc`.
- **Ink** `oklch(22% 0.01 155)` → `#161d18`: text and hairlines. Never pure black. Secondary `#465049` and tertiary `#5a635d` both clear 4.5:1 on all three grounds, pressed included.
- **Charcoal** `oklch(19.5% 0.008 70)` → `#171411` and **Bone** `oklch(92% 0.01 80)` → `#e9e4dc`: the night scheme's ground and text, warm and with no blue in them. Same structure, same green, re-tuned.
- **Hairline**: ink at 16% alpha; the chart-axis rule at 42% light, 40% dark.

### State
Two tones the accent cannot carry, because green already means "this is the live one". Both are the accent's tonal weight, tinted the same way, and neither ever appears without words.
- **Warn** `#7b4c00` light, `#e1b265` dark: known but not current. A stale Whoop mirror, a queue the phone cannot drain.
- **Danger** `#921a1f` light, `#ee867b` dark: wrong and blocking. An invalid answer, a save that did not land, a week of training that has synced nowhere in two days.

### Data Palette
Charts, chips, and glyph fills only. Each colour sits at least 22 CIEDE2000 from the accent so it can never read as "selected", and each pair inside a group stays separable under protanopia, deuteranopia, and tritanopia. Each is always paired with a label or glyph.
- Categories, light: Strength `#1c7adb`, Plyometrics `#e75623`, Technique `#543595`, Mobility `#b67594`. Dark: `#3e7cc5`, `#e75623`, `#b79dff`, `#ad5d7c`.
- Recovery, light: low `#af3d34`, moderate `#b5820c`, high `#009b72`. Dark: `#cb473d`, `#da8c00`, `#1a7f73`. High sits on a deep sea green rather than grass so it cannot be mistaken for the accent.

### Named Rules
**The Restrained Rule.** On every daily surface, green is at or under 10%. Its rarity is what makes the checked row and the goal tick legible.

**The PR Exception.** A same-instrument personal record at or above that instrument's PR threshold (1.0 in by default, recalibrated from the device's own noise after three sessions), and the goal-reached card, may go committed: green carries 30 to 60% of the surface, with paper or bone text on it. This is the one place the system raises its voice. It never fires during the first three calibration sessions on a new instrument or on a stream change. An ordinary test result stays on paper; only the test block's header line takes the accent.

The committed surface is composed rather than coloured: three bands (what happened, the reading, what it belongs to) separated by a hairline in the surface's own text colour, 24px of padding, and 32px of silence above and below the number. It carries no ornament of any kind. It is also the one surface in the app that arrives rather than appears, at 320ms of ease-out on opacity and a 6px settle, once, and never under reduced motion.

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

**The One Big Number Rule.** A screen may make one number large. If two numbers compete for the display size, neither is the point. That number is set through one readout component, never by hand: display tracking at -0.024em, the unit on the number's own baseline, and the number hung left by its digit's measured sidebearing (2px at 64, 3px at 96) so the first stem and not the glyph box lands on the column the eyebrow and the instrument label are already on.

## 4. Elevation

Flat. Surfaces sit at one level; hierarchy comes from type scale, tone (a second neutral a few percent darker or lighter for panels and the bottom bar), and hairline rules. Shadows are prohibited at rest. The only lifted objects are transient sheets and dialogs, which get a single soft ambient shadow so they read as temporary.

### Named Rules
**The Hairline Rule.** Separation is a 1px rule in the ink color at low opacity, or a change of tone. Never a border-radius-and-shadow card, never a colored side stripe.

## 5. Components

Four system components carry the structure the session and the week are read through. All four are flat, hairline-separated, and pair every colour with a word.

- **The timeline spine.** The session view runs one hairline down its left edge with a node on it for every block: the warm-up group, each exercise, the test block. Nodes are leading numbers or registry glyphs, never photographs, and the block name moved off its own heading onto the exercise's meta line. Exactly one node is green: the first that is not finished. A node the runner cannot honestly read as finished (the jump test, which owns its own query) sits on the spine without a state.
- **The exercise meta line.** One muted line under the name: "Main lift · 4 sets · 5 × 205 lb". Identical sets collapse, unequal sets are listed ("5 × 205 / 4 × 220 / 3 × 235"), so the Tabular Rule holds and no single load ever stands for a whole exercise. Per-set data stays on the set rows.
- **The floating action.** One primary action per session, 56px, green, pinned bottom right above the tab bar, with no shadow: what separates it from the rows sliding under it is a 1px cut of the paper ground. If a screen needs two of these, one of them is not an action for that screen.
- **The segmented week bar.** The compact week summary is one segment per training day the program scheduled, filled when that day was finished, over the sentence that says the same thing ("Week 4: 2 of 4 sessions done"). Never a ring, never a percentage.
- **The theme preference.** Three answers, stored in the kv table as `settings.themeOverride`: system (no row), light, dark. The launch splash is held until that row has been read, so no frame ever paints in the scheme the athlete did not ask for. Settings holds the three-way segmented control; the Progress header holds a one-tap control that pins the opposite of what is on screen, named for what the tap will do.

## 6. Do's and Don'ts

### Do:
- **Do** keep every daily surface light paper with ink and one green; let the night scheme follow the system setting.
- **Do** set every digit in tabular figures and right-align numeric columns.
- **Do** draw charts with direct labels on points, a dashed goal line, labeled axes, and recovery aligned beside output at the same time scale.
- **Do** draw every chart line at one of three stroke weights and no others: 0.75 for the graticule, 1 for anything the reader measures against (axis rules and ticks, band edges, required pace, medians, today, the crosshair, the observed path), 2 for the readings themselves (trend, projection, rolling median). Both axes carry a 3px tick, an axis label sits on its tick's true position and turns its anchor at the ends rather than sliding inwards, and a PR is a ring around its own mark whose legend key is the same two circles at the same two radii.
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
