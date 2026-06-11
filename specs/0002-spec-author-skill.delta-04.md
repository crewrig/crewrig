---
id: "0002"
slug: spec-author-skill
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 209
version: 1.4.0
---

# 0002 — spec-author-skill (delta-04)

This delta adds one requirement (R17) to spec 0002 mandating that the
`spec-author` skill, when conversing with a user whose preferred
language is not English, produces idiomatic prose in that language —
not direct calques of English software-engineering jargon. The
friction surfaced live in #209: during the same session that
introduced R15 (delta-02, prose discipline for interactive question
batches), the skill emitted phrases like *« le cold reviewer a
verdicté »*, *« amender en-branche »*, and *« merger »* used as a verb
— franglais that the user explicitly pushed back on with "ça me coûte
de l'énergie à lire".

R15 already covered three prose-quality axes — contextualizing
preface, acronym discipline, and option-description self-sufficiency
— but said nothing about idiomatic language quality. R17 closes that
gap. It applies to the same modes as R15 (MINIMAL / INTERMEDIATE /
FULL) plus AUTO when AUTO emits user-visible artifacts.

## ADDED

1. **New requirement (R17) — idiomatic language quality in
   user-facing prose.** When the user's preferred language is not
   English (as declared by the user or inferred from the conversation
   register), the `spec-author` skill SHALL produce its
   user-facing prose — the contextualizing preface mandated by R15,
   the question text itself, the option `label` and `description`
   fields, and any inline progress messages — in **idiomatic** form
   in that language. Direct calques of English software-engineering
   jargon SHALL be avoided.

2. **Calque catalog.** The skill MAINTAINS the following
   non-exhaustive correspondence list, against which it self-checks
   before emitting any batch in French. Equivalent catalogs for
   other supported languages MAY be added in future deltas; the
   French list is the seed.

   | English source | Calque to avoid (French) | Idiomatic French |
   |---|---|---|
   | `cold reviewer` (noun) | `cold reviewer` / `reviewer froid` | `contrôle indépendant` / `contrôleur indépendant` |
   | `verdict` (verb form *"to verdict"*) | `verdicter` / `a verdicté` | `rendre un verdict` / `trancher` / `prononcer un verdict` |
   | `to merge` (verb) | `merger` (calque) | `fusionner` |
   | `merge` (noun) | `un merge` | `une fusion` |
   | `to amend` (in the Git sense) | `amender` used as English `amend` | `modifier` / `rectifier` / *(for commits)* `corriger le commit` |
   | `in-branch` (adjective) | `en-branche` (calque) | `directement sur la branche` |
   | `pull request` (noun) | `PR` *(without first-use expansion)* | `pull-request` *(spelled out at first use)* |
   | `to spawn` (an agent) | `spawner` | `lancer` / `démarrer` |
   | `to push back` (idiomatic) | `pousser en arrière` | `contester` / `s'opposer à` |
   | `to ship` (a feature) | `shipper` | `livrer` / `publier` |

   The catalog is informational, not exhaustive. The skill is
   expected to extrapolate from the listed patterns to unlisted ones
   — a verb-form anglicism in `-er` derived from an English verb is
   the canonical red flag.

3. **Trigger detection.** The skill SHALL classify a session as
   "non-English preferred language" when ANY of the following holds:

   1. The user has explicitly declared a preferred language other
      than English (a configuration file, a memory record, or a
      direct conversational statement *"écris-moi en français"*,
      *"escríbeme en español"*, etc.).
   2. The user's last three messages were predominantly written in
      a language other than English.
   3. The session has previously emitted user-facing prose in a
      language other than English without correction.

   When in doubt, the skill SHALL default to producing the prose in
   the user's last-message language and apply R17 accordingly.

4. **AUTO mode applicability.** R17 applies in AUTO mode whenever
   AUTO emits any user-visible artifact in a language other than
   English — for example, a `[AUTO-PARKED]` open-question bullet
   addressing the user, a progress message logged for user review,
   or a logbook comment intended to be read by the user. AUTO is
   not exempt simply because no interactive question batch is
   emitted.

## MODIFIED

1. **`specs/0002-spec-author-skill.md` → `## Scenarios` (after the
   three failure-path scenarios from delta-02 R15 and the two from
   delta-03 R16).** Two new scenarios SHALL be inserted, one
   happy-path and one failure-path, recording the contract R17
   imposes:

   ```text
   **Scenario:** Skill produces an idiomatic French interview prose
   in INTERMEDIATE mode

   Given the skill is running in `INTERMEDIATE` mode and the user's
         preferred language is French (declared explicitly via memory
         record or inferred from the session's last messages)
   When  the skill emits an interactive question batch
   Then  the contextualizing preface, question text, option labels,
         and option descriptions SHALL be written in idiomatic French
   and   no calque from the catalogue under R17 sub-clause 2 SHALL
         appear in the prose
   and   the cold spec-reviewer audits the prose for idiomatic
         correctness and emits no `class: tech` finding.
   ```

   ```text
   **Scenario:** Reviewer rejects a French interview batch emitted
   with English-software-jargon calques

   Given the skill is running in `INTERMEDIATE` mode with French as
         the user's preferred language
   When  the emitted batch contains a calque listed in the R17
         catalogue (for example *"le cold reviewer a verdicté"*,
         *"amender en-branche"*, *"merger"* as a verb) anywhere in
         the preface, question text, option labels, or option
         descriptions
   Then  the cold spec-reviewer SHALL reject the resulting spec PR
   and   the finding SHALL carry `class: tech` per the retroactive
         routing matrix.
   ```

## REMOVED

(None. The delta is purely additive; R17 strengthens R15 without
removing or relaxing any existing requirement.)
