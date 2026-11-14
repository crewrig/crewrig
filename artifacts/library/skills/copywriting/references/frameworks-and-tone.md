# Frameworks and tone

## Contents

- PAS: Problem, Agitate, Solution
- BAB: Before, After, Bridge
- AIDA: Attention, Interest, Desire, Action
- Tone calibration

## PAS: Problem, Agitate, Solution

Use when the reader may not yet recognise they have the problem. Name the problem, dwell
on its cost, then introduce the solution as relief.

```text
Problem:  Your CI pipeline takes 18 minutes per push.
Agitate:  That's 90 minutes of context-switching per developer per day.
Solution: Cached builds cut that to 3 minutes. Here's how.
```

PAS is high-friction: the agitation step risks feeling manipulative if the audience is
technical and already sceptical. Use it sparingly with developer audiences and lean on it
harder for non-technical buyers.

## BAB: Before, After, Bridge

Use when the reader already feels the problem. Paint the current state, paint the desired
state, then make the product the bridge.

```text
Before: Manual deploys, broken Friday afternoons, rollback panic.
After:  One-click deploys, green dashboards, time back for real work.
Bridge: Our pipeline gives you both: preview environments and
        automatic rollback on health-check failure.
```

BAB works well for developer tools because the "before" state is shared lore: readers
recognise themselves immediately.

## AIDA: Attention, Interest, Desire, Action

Use for long-form pages where the reader needs convincing in stages. Attention is the
headline, Interest is the value proposition, Desire is the features and social-proof block,
Action is the CTA.

AIDA is more of an outline than a tactic, since most landing pages implicitly follow it.
Use it as a checklist: if you cannot point at each of the four moments, a section is
missing.

## Tone calibration

Tone is decided once per project and applied consistently. The default register for
developer-facing open-source tools is **technical-but-accessible**:

- **Precise**: name things by their real names. "Build cache" not "magic speed thing".
- **Confident, not boastful**: state what the tool does without superlatives. "Runs in
  200 ms" beats "blazingly fast".
- **Human**: contractions are fine ("we're", "you'll"). Avoid corporate filler
  ("leverage", "synergy", "best-in-class"); the linter flags these.
- **Honest about limits**: say what the tool does *not* do. This builds more trust than
  feature inflation.

For consumer products the register shifts: shorter sentences, more metaphor, fewer
specifics. For enterprise sales pages it shifts again: more nouns, more compliance
vocabulary, longer sentences. Calibrate to the audience and hold the line.
