---
id: "0184"
slug: extension-authoring-docs
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1009
version: 1.0.0
---

# Extension authoring documentation surface

## Intent

A contributor who sets out to author an extension finds, inside the published
documentation set, one page that states what an extension is, what it may
declare, how it reaches an adopter, and where each normative detail is written
down — and a second page that carries the development story for an extension's
own MCP server. Every root-level and adoption-facing document that mentions
extensions reaches that home, and none of them still names an outdated set of
supported command-line tools or an outdated delivery mechanism. The manifest
and render contract that five successive changes each rewrote a part of reads
as one document rather than five: no passage contradicts another, no
cross-reference points the wrong way, no unqualified requirement number is
ambiguous, and every citation of the document from outside it resolves to the
passage it quotes. Nothing about how an extension is declared, rendered,
installed, or released changes: this sixth and final sub-spec of the
issue #725 redesign describes the model its five predecessors built, and
decides nothing about it.

## Requirements

1. **(A published authoring home)** The repository SHALL carry a documentation
   page that is the entry point for extension authoring, SHALL place it under
   `docs/`, and SHALL give it a metadata block conforming to
   [`docs/publication-contract.md`](../docs/publication-contract.md) that
   declares it published and assigns it the `authoring` section, so that
   `docs/index.json` lists it. The page SHALL be reachable from the published
   set without a reader first opening a root-level file.
2. **(What the home covers)** That page SHALL name the single hand-authored
   manifest an extension carries, the render-at-publication model that makes
   every command-line-tool-designated file a build output, each generic
   declaration subject the manifest admits, the delivery paths through which a
   rendered tree reaches an adopter together with the path documented as
   unsupported, and every command-line tool the render supports. A subject,
   path, or tool the model supports SHALL NOT be omitted from that page, and a
   subject, path, or tool it does not support SHALL NOT be named as supported.
3. **(One role per document, stated)** The page of requirement 1 SHALL state
   the division of labour between itself and each neighbouring document — the
   normative manifest and render contract, the hands-on development and release
   procedure, the hook-event vocabulary reference, and the MCP-server guide of
   requirement 4 — and SHALL reach each of them by a link. It SHALL NOT restate
   the content those documents carry; where a reader needs a normative detail,
   the page SHALL send them to the document that owns it.
4. **(The MCP-server development guide)** The repository SHALL carry a
   documentation page under `docs/`, published and assigned the `authoring`
   section on the same terms as requirement 1, that covers developing an
   extension's own MCP server: the source directory and the build-output
   directory an extension keeps at its root and which of the two a declared
   command names; the admissible transports and which one an omitted transport
   selector means; the one neutral path token an extension names, together with
   the party that resolves it and the moment it is resolved for each supported
   command-line tool; and the additional install-time step the one tool that
   resolves nothing at render time requires. An extension that implements no
   server of its own SHALL be covered by the same page as the case that carries
   neither directory.
5. **(Describes, never decides)** Neither page SHALL introduce a normative
   statement that is not already carried by a merged spec, by
   `extension-skeleton/EXTENSION-FORMAT.md`, by
   [`docs/extension-hook-events.md`](../docs/extension-hook-events.md), or by a
   recorded probe runbook under `docs/runbooks/`. Each normative claim a page
   makes SHALL name the source that carries it, and where a page and its named
   source disagree the source SHALL govern. A detail a page cannot attribute
   SHALL be omitted rather than asserted.
6. **(Release form stated as pinned)** No page this change adds or edits SHALL
   describe the release artifact in a way that contradicts
   [`docs/runbooks/extension-release-install-probe.md`](../docs/runbooks/extension-release-install-probe.md):
   the archive carries the rendered tree's contents at its own root with no
   wrapper directory, and it serves the in-place tool alone. A page that
   mentions the artifact SHALL reach that runbook by a link.
7. **(The manifest contract stays where it is)** The authoritative manifest and
   render contract SHALL remain at `extension-skeleton/EXTENSION-FORMAT.md`.
   The change SHALL NOT relocate it, SHALL NOT leave a redirect stub for it at
   any path, and SHALL NOT split it. The grounds, all four verified against
   `47ee9ac`: the repository already answers this question one layer up, where
   `artifacts/FORMAT.md` is the normative contract for the component pipeline,
   sits beside the sources it governs, stays outside the published set, and is
   reached from the published `docs/authoring.md` — the shape requirement 1
   reproduces for extensions; the discoverability hole a relocation would close
   is the one requirement 1 closes already, so moving the file is a second fix
   for a fixed problem; the file is not part of what a scaffold copies, so no
   adopter receives it as template material a relocation would take away; and
   `extension-skeleton` is a core-path entry in the permissive sync mode while
   `docs` is `strict`, so a relocation would convert an adopter's local edit of
   this document from something their sync absorbs into something that halts
   it.
8. **(The component authoring page reaches extensions)** `docs/authoring.md`
   SHALL reach the page of requirement 1 by a link and SHALL state the boundary
   between the component pipeline it describes and the extension model it does
   not, because it names neither today. Its own scope SHALL remain the component
   pipeline; it SHALL NOT absorb extension content.
9. **(The pointer sweep)** `README.md`, `CONTRIBUTING.md`, `DEVELOPMENT.md` and
   [`docs/adoption-guide.md`](../docs/adoption-guide.md) SHALL each reach the
   page of requirement 1 by at least one link placed in the section where that
   document already speaks about extensions. A document that speaks about
   extensions in more than one section SHALL be reachable from at least one of
   them, not necessarily from every one.
10. **(No stale supported-tool or delivery claim survives the sweep)** In every
    document the change touches, a statement that names the set of
    command-line tools an extension serves SHALL name that set as the render
    supports it, and a statement that names how a rendered extension reaches a
    tool SHALL name the current model rather than a superseded one. Two such
    statements are known stale at `47ee9ac` and SHALL be repaired: the opening
    of `DEVELOPMENT.md`, which names three tools and describes one of them as
    consuming the extension in place from a directory it no longer consumes;
    and the extension paragraph of `README.md`, which describes install
    scripts as generating outputs for two tools.
11. **(Examined and unchanged is a recorded outcome)** `AGENTS.md` and
    [`docs/cli-matrix-maintenance.md`](../docs/cli-matrix-maintenance.md) SHALL
    each be examined for a statement this change makes stale, and where none is
    found the file SHALL be left unmodified and the examination's outcome SHALL
    be recorded on the ticket's logbook. An unmodified file SHALL NOT be
    reported as overlooked, and an examination SHALL NOT be reported as an
    edit.
12. **(The seams of the manifest contract)** `extension-skeleton/EXTENSION-FORMAT.md`
    SHALL be brought into internal agreement without any change to what it
    obliges, permits, or forbids. Four defects are known at `47ee9ac` and SHALL
    be repaired: a passage stating that the context subject's own sub-spec has
    not landed, which its own opening section contradicts; every
    intra-document cross-reference whose stated direction no longer matches the
    referenced section's position; the ambiguity of an unqualified requirement
    number now that five specs contribute requirements to one document, which
    SHALL be resolved either per reference or by one stated default at the head
    of the document plus an explicit qualification wherever the governing spec
    is not that default; and the document's own title and opening scope
    sentence, which name only the manifest while the document also carries the
    render, delivery, context, hook and scaffolding material. A repair that
    changes a normative statement SHALL NOT be made here.
13. **(Citations of the contract resolve)** Every reference to
    `extension-skeleton/EXTENSION-FORMAT.md` from outside that file SHALL
    resolve to the passage it names. Two are known broken at `47ee9ac` — the
    line-pinned citation in `scripts/lib/extension-targets.json` and the one in
    `tests/extension-context-delivery-evidence.md`, which both quote a sentence
    that no longer sits at the line they name — and SHALL be repaired. The
    change SHALL NOT introduce a new line-number-pinned citation of a Markdown
    file; a citation SHALL name the passage by its section or by its quoted
    text instead.
14. **(The documentation gates stay green, and nothing else changes)** After the
    change, `bash scripts/build-docs-index.sh --check`, the repository's own
    `markdownlint` invocation, and `bash scripts/check-markdown-links.sh` SHALL
    all pass. The change SHALL introduce no new script, no new continuous-
    integration capability, and no new check; it SHALL modify no renderer, no
    build script, and no spec's requirements. Where the change edits a
    non-Markdown file, the edit SHALL be confined to the citation repair
    requirement 13 mandates.

## Scenarios

**Scenario:** A contributor reaches the authoring model from the published set

Given a reader who opens `docs/index.json` and has never read a root-level
      file of this repository
When  they follow the `authoring` section's pages
Then  they reach the extension authoring home, and from it a link to the
      normative manifest and render contract, a link to the MCP-server guide, a
      link to the hook-event vocabulary, and a link to the hands-on development
      and release procedure.

**Scenario:** An author develops an extension's own MCP server without a second
source

Given an author who has read only the MCP-server guide
When  they lay out their server, declare it, and ask which party resolves the
      path token their declaration names on each supported command-line tool
Then  the guide answers all four, names the resolving party and the moment for
      each, names the extra install-time step the tool that resolves nothing at
      render time needs, and attributes each of those answers to the spec or the
      probe runbook that fixed it.

**Scenario:** A guide asserts a rule no named source carries

Given a draft page that states an obligation on extension authors
When  the reviewing pass looks for the merged spec, the manifest contract, the
      hook-event reference, or the probe runbook that carries that obligation
And   finds none
Then  the pass names the unsourced statement as a `spec`-class deviation from
      requirement 5, and the statement is removed or attributed before the
      change lands.

**Scenario:** The manifest contract is relocated or stubbed

Given a change under this spec that moves
      `extension-skeleton/EXTENSION-FORMAT.md` under `docs/`, or leaves a
      redirect stub at its old path
When  the reviewing pass reads requirement 7
Then  the pass rejects the relocation, and the maintainer's confirmation of
      requirement 7's decision at the specification gate is the only route by
      which the decision could have been the other one.

**Scenario:** A page contradicts the pinned release form

Given a page that describes the release archive as carrying a wrapper
      directory, or as serving a tool other than the in-place one
When  the reviewing pass compares the page against
      `docs/runbooks/extension-release-install-probe.md`
Then  the pass names the contradiction as a deviation from requirement 6, and
      the page is corrected to the probed form rather than the runbook being
      re-argued.

**Scenario:** A documentation gate turns red

Given a change under this spec that adds a page whose metadata block is absent
      or malformed, or a link that does not resolve
When  `bash scripts/build-docs-index.sh --check` or
      `bash scripts/check-markdown-links.sh` runs
Then  the failing gate names the offending page or link, and the change is not
      complete until every one of the three gates of requirement 14 passes.

## Out of scope

- **Relocating the manifest contract under `docs/`**, and the redirect stub
  such a relocation would require. Requirement 7 decides against it and records
  the grounds. One argument for relocation survives that decision and is not
  answered by it: the repository's `markdownlint` invocation ignores
  `extension-skeleton` wholesale, so this 669-line document is the largest
  unlinted Markdown file in the tree while every page under `docs/` is linted.
  Relocation is not the remedy this spec chooses for that; see the next bullet.
- **Narrowing the `markdownlint` ignore so that
  `extension-skeleton/EXTENSION-FORMAT.md` becomes linted while the skeleton's
  template files stay ignored.** That changes what continuous integration
  fails on, which is a behaviour change and not a documentation change; it
  belongs to its own ticket, which this spec does not open.
- **Adding the extension skeleton directory to the CLI-matrix trigger
  surface** named in `AGENTS.md` and `docs/cli-matrix-maintenance.md`. That
  would create a new
  same-diff obligation on future changes rather than describe an existing one.
- **Any change to a normative statement** in
  `extension-skeleton/EXTENSION-FORMAT.md`, in any merged spec's requirements,
  or in any renderer, build script, install script, or check. A correction to
  normative content chains through a delta-spec on the spec that owns it, never
  through this documentation pass.
- **A new automated coherence check** over the extension documentation set — a
  script that would compare the guides against the manifest contract, or the
  contract against the specs. The coherence scenarios above are verified by the
  REVIEW pass; only the three gates of requirement 14 are automated, and all
  three already exist.
- **Restructuring `DEVELOPMENT.md`** — moving its procedure content under
  `docs/`, splitting it, or removing the `Session Transcript Activation`
  section it carries that concerns extensions not at all. Requirement 9 adds a
  link to it and requirement 10 repairs one stale sentence in it; nothing else
  about that file is in scope.
- **Publishing or translating the extension documentation** on the separate
  website repository that consumes `docs/index.json`.
- **Documenting a subject, tool, or delivery path the model does not support
  today.** A page describes what `47ee9ac` carries; a planned or proposed
  capability is named by the ticket that plans it, not by these pages.

## Open questions

*(none — the structural decision requirement 7 records is put to the
maintainer at the specification gate rather than left open here, and the two
questions the grounding pass raised are settled in `## Out of scope`.)*
