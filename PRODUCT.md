# Product

## Register

product

## Users

One user: the owner, an advanced speed climber (IFSC 15 m) training solo to raise their vertical jump and upper-body power. Wears a Whoop. Has an A2 pulley history, so pulling is open-hand only and hard finger sessions are spaced; runs a valgus-control protocol separated from wall time.

Two contexts, both daily:

- **In the gym or at the wall**, phone in hand, sweaty between sets, under bright overhead or outdoor light. Needs the next drill, the load, and the rep target at arm's length. Taps with wet thumbs.
- **In the evening**, on an iPhone, iPad, or laptop depending on the day, reviewing the week: test results, completion, Whoop recovery and strain next to output. Wants to study, not skim.

The gym client is a native iOS app installed through TestFlight (the owner uses an iPhone). The same codebase serves the evening review on the web.

Frequency: a session most days, a jump test once a week. No other users, no sharing, no accounts to manage beyond the owner's own login and Whoop link. The first-run flow still exists because the app cannot generate a program without a baseline.

## Product Purpose

Generate a rule-based, periodized program for vertical jump and upper-body power from the athlete's baseline, training age, training days, injury status, sport (speed climbing), and target date. The program rules come first from the ThisFiTT Rule Book v5 and Onboarding V1 (docs/source), with published training evidence applied only where those documents are silent or would be unsafe. Run each day's session as a per-set log with exact loads. Log weekly jump tests measured on an OVR Jump laser device, and bar velocities from an OVR Velocity sensor. Show progress toward the goal. Pull Whoop recovery, sleep, and strain to give context and to log training strain against sessions.

Autoregulation (adjusting a session from recovery data) is a designed capability, not a launch behavior. It stays off until the app has enough of the owner's own data to say what a low recovery score actually means for their jumping. When it turns on, it explains every adjustment.

Success: the owner opens the app on every training day, finishes the session, tests weekly, and the vertical trends toward the goal by the target date. Secondary success: recovery-versus-output patterns become legible enough to justify enabling autoregulation.

## Brand Personality

Three words: precise, composed, legible.

A coach's clipboard crossed with a lab notebook, with a few scoreboard moments where a number is allowed to be big (the current vertical, a new PR). Analytics-first, never an eyesore. Copy is direct and second person, numbers over adjectives, no hype. The app should feel like an instrument the owner trusts, not a motivational product.

## Anti-references

- The Base44 prompt pack's look: dark slate ground, neon teal and amber accents, glow utilities, clipped tag shapes. Every styling instruction in that pack is discarded by the owner's decision.
- The generic fitness dashboard: hero metric banner, a grid of identical stat cards, a motivation banner, a confetti modal, a shareable summary card.
- Gym-bro aesthetics: aggressive display type, flame iconography, "beast mode" copy.
- Consumer-wellness softness: pastel gradients, progress rings on everything, mascot energy, streak guilt.

## Design Principles

1. **Numbers are the interface.** Every screen leads with a measurement the owner can act on. Decoration never competes with data.
2. **Glanceable in the gym, studyable at night.** The session view works at arm's length on a wet phone in bright light. The progress view rewards a long look.
3. **Earn autoregulation.** Show recovery beside output first. Adjust training only when the owner's own data supports a rule, and always say why.
4. **Familiar tools, no surprises.** Standard controls, predictable structure, category-best patterns for logging and review. Delight lives in moments (a PR), not on every screen.
5. **Honest states.** Empty, loading, partial-sync, stale-Whoop, and error states say what is known and what is not. Nothing pretends.

## Accessibility & Inclusion

- WCAG 2.2 AA contrast and focus visibility throughout.
- Respect `prefers-reduced-motion`: no confetti, no pulsing indicators, no celebratory choreography.
- Training categories and recovery bands are never distinguished by color alone; each carries a label or glyph.
- Touch targets of at least 44px on the session view, with generous spacing, for wet-thumb use between sets.
- Legible under bright gym and outdoor light as well as in a dim room.
