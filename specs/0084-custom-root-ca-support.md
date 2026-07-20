---
id: "0084"
slug: custom-root-ca-support
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 569
version: 1.0.0
---

# Custom root certificate authority support and native TLS delegation

## Intent

A developer working behind a corporate certificate-intercepting network
gateway, or against a private server that presents a certificate signed by a
custom or private certificate authority, can complete the framework's guided
setup and every subsequent framework-triggered network operation — whether it
runs during setup, during a build or continuous-integration phase, or at
runtime (including the retrieval of runtime assets such as embedding models) —
without hitting certificate-trust failures. During setup the developer is told
when their environment appears to require custom certificate trust and is
offered, only with explicit consent, to have that trust honoured across the full
set of network operations the framework performs on their behalf; declining
leaves their environment untouched. Reference documentation describes, for each
category of framework-triggered network operation, how to make the responsible
tool honour the operating system's existing trust store on macOS and Linux,
together with guidance for diagnosing the certificate failures that motivated
this change. Throughout, the framework only ever extends trust to the
developer's already-installed custom authority and never weakens, bypasses, or
disables certificate verification.

## Requirements

1. The project SHALL provide a reference runbook, under the repository's
   runbook documentation area, that documents — for each category of
   framework-triggered network operation, at minimum package and dependency
   installation, build and continuous-integration phases, version-control,
   context-protocol server registration and operation, tool and binary
   installers, and runtime asset or model downloads (such as embedding models)
   — how to make the responsible tool honour the operating system's existing
   trust store on both macOS and Linux, and that includes a troubleshooting
   section covering the certificate-trust failures this specification addresses.
2. Each of the four interactive setup scripts (Claude Code, Gemini CLI, GitHub
   Copilot CLI, Antigravity CLI) SHALL detect when the environment appears to
   require custom certificate trust and SHALL offer the user the option to
   configure that trust delegation for the framework's full set of network
   operations — spanning setup, build and continuous-integration phases, and
   runtime — and not only its context-protocol servers.
3. The offer in requirement 2 SHALL require explicit user consent before any
   configuration is applied; when consent is not given, the offer SHALL be a
   strict no-op that writes nothing to any persistent location and leaves the
   user's environment unchanged.
4. The detection in requirement 2 SHALL rely on deterministic environment
   signals — such as the presence of a custom or private certificate authority
   in the operating-system trust store, or certificate or proxy environment
   variables already set in the user's environment — and SHALL NOT depend on
   parsing localized or version-specific error text emitted by any tool.
5. The feature SHALL only ever extend trust to the user's already-installed
   custom or corporate certificate authority and SHALL NEVER recommend,
   configure, or apply any setting that disables, bypasses, or weakens
   certificate verification (for example `NODE_TLS_REJECT_UNAUTHORIZED=0`,
   `git config http.sslVerify false`, or `PYTHONHTTPSVERIFY=0`).
6. The feature SHALL rely solely on standard, tool-native trust-configuration
   mechanisms and the operating system's trust-store locations, and SHALL NOT
   introduce a framework-owned certificate store, a bespoke trust format, or
   any new vendor-specific dependency.
7. The project SHALL document the operating-system process-inheritance model by
   which child processes the framework spawns — its hooks, its background
   processes, and its sub-agents — inherit the certificate and proxy
   environment of the parent command-line tool, so that a user who has
   configured trust for a CLI understands that the framework's spawned work
   inherits it.
8. Where, and only where, the framework actively scrubs or fails to propagate
   the certificate or proxy environment to a child process it spawns, the
   framework SHALL be changed to preserve that environment; where the framework
   already relies on default inheritance, the documentation of requirement 7
   SHALL be the sole deliverable and no code change SHALL be mandated for that
   path.
9. Any behavior added to a setup script SHALL be implemented symmetrically
   across all four supported CLIs, or the realization SHALL record concrete
   gap-acceptance evidence for any CLI where the mechanism genuinely does not
   exist, per the project's CLI-matrix maintenance protocol.
10. Any change to a CLI integration point made in realizing this specification
    SHALL update the CLI-matrix document in the same change set, and any change
    that adds, removes, or reclassifies a core-layer path SHALL update the
    core-paths manifest in the same change set.
11. When consent is given, the configuration SHALL be written only to a
    dedicated, clearly identified location managed by the framework that the
    user can remove in a single action; the framework SHALL NOT modify the
    user's pre-existing shell profile or global tool configuration in place; and
    the exact configuration applied SHALL be shown to the user.
12. The realization SHALL include an impact analysis that enumerates every
    framework-triggered network operation requiring custom-certificate trust —
    across setup, build and continuous-integration phases, and runtime — so that
    the runbook of requirement 1 and the detection and offer of requirements 2
    and 4 cover the full surface rather than a subset.

## Scenarios

**Scenario:** setup detects a corporate-TLS context, offers delegation, and
bootstrap succeeds (happy path)

```text
Given a developer behind a corporate certificate-intercepting gateway whose
      custom certificate authority is installed in the operating-system trust
      store,
When   the developer runs one of the four interactive setup scripts,
Then   the script detects the custom-trust context and offers to configure
       trust delegation for the tools the framework runs,
And    after the developer consents, the framework's bootstrap — package
       install, context-protocol server registration, and version-control
       operations — completes without a certificate-trust failure.
```

**Scenario:** a developer configures trust manually from the runbook (happy
path)

```text
Given a developer on macOS whose private certificate authority is installed in
      the system trust store and who does not run the interactive offer,
When   the developer follows the reference runbook for the tools the framework
       invokes,
Then   each tool is pointed at the system trust store as documented,
And    the framework's bootstrap completes without a certificate-trust failure.
```

**Scenario:** the feature never disables certificate verification (failure /
guard)

```text
Given a developer whose environment shows a custom-trust context but who has no
      usable custom certificate authority available,
When   the setup script runs and cannot establish trust through the standard
       mechanisms,
Then   the script SHALL NOT recommend, configure, or apply any
       verification-disabling setting,
And    it reports that trust could not be configured and points the developer
       to the runbook's troubleshooting section.
```

**Scenario:** declining the offer leaves the environment untouched (failure /
guard)

```text
Given a setup script has detected a custom-trust context and presented the
      offer,
When   the developer declines,
Then   the script writes nothing to the shell profile, global tool
       configuration, or any other persistent location,
And    the developer's environment is byte-for-byte unchanged by the offer.
```

**Scenario:** consent writes only to a framework-managed, reversible location
(happy path)

```text
Given a setup script has detected a custom-trust context and presented the
      offer,
When   the developer consents,
Then   the configuration is written only to a dedicated, clearly identified
       location managed by the framework that the developer can remove in a
       single action,
And    the developer's pre-existing shell profile and global tool configuration
       are unchanged,
And    the exact configuration applied is shown to the developer.
```

**Scenario:** detection uses deterministic signals, not tool error text (happy
path)

```text
Given a developer whose operating-system trust store contains a custom
      certificate authority,
When   a setup script evaluates whether to present the offer,
Then   the decision is derived from the trust-store contents and the certificate
       or proxy environment variables already set,
And    the decision does not depend on parsing any tool's localized or
       version-specific error output.
```

**Scenario:** a spawned child process inherits the configured trust (happy
path)

```text
Given a developer has configured custom certificate trust for a CLI as
      documented,
When   the framework spawns a hook, a background process, or a sub-agent from
      that CLI,
Then   the child process inherits the parent's certificate and proxy
       environment and performs its network work without a certificate-trust
       failure.
```

**Scenario:** a runtime asset download succeeds once trust is configured (happy
path)

```text
Given a developer behind a corporate certificate-intercepting gateway who has
      configured custom certificate trust as offered during setup,
When   the framework retrieves a runtime asset on first use — for example an
      embedding model fetched for indexing, distinct from the earlier package
      install,
Then   the download completes over the intercepted connection without a
       certificate-trust failure.
```

**Scenario:** a build-phase network fetch succeeds once trust is configured
(happy path)

```text
Given a developer behind a corporate certificate-intercepting gateway who has
      configured custom certificate trust,
When   a build or continuous-integration phase fetches a tool, binary, or
      package over the network,
Then   the fetch completes without a certificate-trust failure.
```

## Out of scope

- Shipping or bundling any certificate authority certificate with the
  framework; the user's custom authority is assumed already installed in the
  operating-system trust store.
- Installing, removing, or otherwise managing entries in the operating-system
  trust store itself.
- Managing credentials for authenticated proxies (proxy usernames, passwords,
  or tokens).
- Automating per-repository version-control certificate configuration beyond
  documenting it in the runbook.
- Detecting or supporting certificate-trust needs for tools the framework does
  not itself invoke.
- Windows platform support; detection, the setup offer, and the runbook's
  coverage all target macOS and Linux only, matching the framework's bash setup
  surface. Windows may be addressed in a later delta-spec if demand emerges.
- Any offering that would disable, bypass, or weaken certificate verification;
  excluded by the security invariant and never presented as an alternative.

## Open questions

None. The three questions raised while authoring — platform scope, the consent
persistence model, and whether the passthrough approach needs code — were
resolved before approval; the closure is recorded on logbook issue #569.
