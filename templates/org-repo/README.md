# Organization config repository

This repository was created from the CrewRig organization template. It holds the
launcher `crewrig` and the pin `crewrig.pin.json`, which name one CrewRig framework
version and the SHA-256 digest of its release asset. Nothing else is installed
before the launcher first runs.

Running CrewRig through this launcher, `node crewrig <command>`, is the default way
to use CrewRig in your organization.

## Prerequisites

Node.js 24 or later. On any other major version the launcher prints one sentence,
exits with code 10 and downloads nothing.

## First run

1. Run `node crewrig init` in the root of this repository. When the repository has
   no GitHub `origin` remote, pass the repository that receives feedback on your
   organization's components: `node crewrig init --feedback-repo <url>`, for example
   `https://github.com/acme/crewrig-config`. The value must be a repository URL
   `https://<host>/<owner>/<repo>` and must not be the CrewRig upstream repository
   unless you pass it on purpose.
2. Review the files that `init` created.
3. Commit them.

`init` runs once, in the repository created from the template. It refuses when
`crewrig.config.toml` already exists, and when the directory holds any file or
directory the template does not provide.

## Running commands

`node crewrig <command> [arguments...]` runs the pinned CrewRig version with your
arguments unchanged, in your working directory, and returns its exit code. The first
run downloads the release, checks it against `crewrig.pin.json`, and caches it under
`~/.crewrig/versions/`. Later runs use the cache and need no network access.

## Changing the pinned version

Changing the pin is a reviewed edit of `crewrig.pin.json`:

1. Open the page of the release you want, under
   <https://github.com/crewrig/crewrig/releases>.
2. Set `version` to its version, the tag without the `crewrig-v` prefix.
3. Set `sha256` to the SHA-256 digest of its `crewrig-<version>.tgz` asset.
4. Commit the change.

The launcher refuses an archive whose digest differs from `sha256`.

## Using a mirror

To fetch the release from your own mirror, set the member `base_url` in
`crewrig.pin.json` to the base URL of the mirror. The mirror must serve the GitHub
Releases layout: `<base>/crewrig-v<version>/crewrig-<version>.tgz`. A base URL is an
`http:` or `https:` URL with a host and no query string, no fragment and no
credentials. For a single invocation, the environment variable
`CREWRIG_RELEASE_BASE_URL` overrides `base_url`; an empty value makes `base_url`
apply again. The launcher verifies the digest the same way for every base URL.
