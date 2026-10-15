// skill-scripts-cases-gitlab-images.ts — the case table of gitlab-ci/check-pinned-images (spec 0258
// R28, plan step 8). It pins the block state machine of the shell: `image:` opens a mapping block
// when its value is empty, `services:` opens a list block, a content line at or under the opener's
// indent closes it, and `name:` / `- ref` only count inside a block.
//
// `find` lists `.gitlab/` in directory order, which no golden can pin (deviation (b)): a case that
// scans a directory therefore holds at most ONE file with findings.
//
// Fixtures are written as one string whose rows are separated by `|` (indentation is kept).

import type { SkillCase } from "./skill-scripts-observe.ts";

const HEX64 = "0123456789abcdef".repeat(4);
const DIGEST = `@sha256:${HEX64}`;
const D = DIGEST;

const yml = (rows: string): string => `${rows.split("|").join("\n")}\n`;
const CI_OK = yml(`build:|  image: node${D}`);
const CI_BAD = yml("build:|  image: node:22");

const SCRIPT = "gitlab-ci/check-pinned-images";

function images(name: string, c: Omit<SkillCase, "name" | "script">): SkillCase {
  return { name, script: SCRIPT, ...c };
}

/** A single file `ci.yml` holding `body` (rows split on `|`), scanned by name. */
const file = (name: string, rows: string): SkillCase =>
  images(name, { args: ["ci.yml"], files: { "ci.yml": yml(rows) } });

/** A single file `ci.yml` holding `body` verbatim. */
const raw = (name: string, body: string): SkillCase =>
  images(name, { args: ["ci.yml"], files: { "ci.yml": body } });

/** A directory case: `repo/` holding `files`. */
const dir = (name: string, files: Record<string, string>, arg = "repo"): SkillCase =>
  images(name, { args: [arg], files });

export const CHECK_PINNED_IMAGES: readonly SkillCase[] = [
  // arguments and targets
  images("no-argument", {}),
  images("two-arguments", { args: ["a.yml", "b.yml"], files: { "a.yml": CI_OK, "b.yml": CI_OK } }),
  images("missing-path", { args: ["missing.yml"] }),
  images("empty-argument", { args: [""] }),
  images("empty-directory", { args: ["empty"], dirs: ["empty"] }),
  raw("empty-file", ""),
  raw("blank-lines-only", "\n\n  \n"),
  raw("single-file-pinned", CI_OK),
  raw("single-file-unpinned", CI_BAD),

  // directories
  dir("dir-ci-alone-unpinned", { "repo/.gitlab-ci.yml": CI_BAD }),
  dir("dir-ci-alone-pinned", { "repo/.gitlab-ci.yml": CI_OK }),
  dir("dir-ci-plus-gitlab", {
    "repo/.gitlab-ci.yml": CI_OK,
    "repo/.gitlab/build.yml": CI_BAD,
    "repo/.gitlab/deploy.yaml": CI_OK,
  }),
  dir("dir-ci-findings-gitlab-clean", {
    "repo/.gitlab-ci.yml": CI_BAD,
    "repo/.gitlab/build.yml": CI_OK,
  }),
  dir("dir-nested-gitlab", { "repo/.gitlab/a/b.yaml": CI_BAD }),
  dir("dir-gitlab-only", { "repo/.gitlab/jobs.yml": CI_BAD }),
  dir("dir-gitlab-non-yaml", { "repo/.gitlab/notes.txt": CI_BAD, "repo/.gitlab/CI.YML": CI_BAD }),
  dir("dir-other-files-ignored", { "repo/other.yml": CI_BAD, "repo/sub/.gitlab-ci.yml": CI_BAD }),
  dir("dir-all-pinned", { "repo/.gitlab-ci.yml": CI_OK, "repo/.gitlab/a/b.yaml": CI_OK }),
  dir("dir-trailing-slash", { "repo/.gitlab-ci.yml": CI_BAD }, "repo/"),
  dir("dir-trailing-slash-gitlab", { "repo/.gitlab/a/b.yaml": CI_BAD }, "repo/"),
  dir("dir-gitlab-ci-is-a-directory", { "repo/.gitlab-ci.yml/inner.yml": CI_BAD }),
  images("file-named-gitlab-ci", { args: [".gitlab-ci.yml"], files: { ".gitlab-ci.yml": CI_BAD } }),

  // line endings and the last line
  raw("lf-unpinned", CI_BAD),
  raw("crlf-unpinned", CI_BAD.replaceAll("\n", "\r\n")),
  raw("lf-pinned", CI_OK),
  raw("crlf-pinned", CI_OK.replaceAll("\n", "\r\n")),
  raw(
    "crlf-blocks",
    yml("build:|  image:|    name: node:22|  services:|    - redis:7|    - name: pg:16").replaceAll(
      "\n",
      "\r\n",
    ),
  ),
  raw("unterminated-last-line", `${CI_OK}  image: node:22`),
  raw("unterminated-pinned", `${CI_BAD}  image: node${D}`),

  // the inline image form
  file(
    "inline-image",
    `build:|  image: node:22|  image: node|  image: node:latest|  image: node${D}|  image: registry.example.com:5000/team/app:1.2`,
  ),
  file(
    "digest-lengths",
    `build:|  image: node@sha256:${HEX64.slice(1)}|  image: node@sha256:${HEX64}|  image: node@sha256:${HEX64}0|  image: node@sha256:${HEX64.toUpperCase()}|  image: node@sha256:${HEX64.slice(1)}g|  image: node:22${D}|  image: node@sha512:${HEX64}|  image: node${D}/sub`,
  ),
  file(
    "variables",
    `build:|  image: $CI_REGISTRY_IMAGE|  image: \${CI_REGISTRY_IMAGE}|  image: $CI_REGISTRY_IMAGE:latest|  image: $CI_REGISTRY_IMAGE:$TAG|  image: $REG/app${D}|  image: $REG@v1|  image: \${REG}/app|  image: node:$TAG`,
  ),
  file(
    "quoted-refs",
    `build:|  image: "node:22"|  image: 'node:22'|  image: "node${D}"|  image: 'node${D}'|  image: "node:22|  image: node:22'|  image: "'node:22'"|  image: ""|  image: ''|  image: "$CI_IMAGE"`,
  ),
  file(
    "trailing-comment",
    `build:|  image: node:22 # lts|  image: node${D} # pinned|  image: node:22# glued|  image: # only a comment|  image:#glued|  image: node:22   `,
  ),
  file(
    "image-line-shapes",
    "\timage: node:tab|image:node:glued|# image: node:commented|  - image: node:dash|script: echo image: node:inline|  IMAGE: node:upper|  image : node:spacecolon|  image:    node:spaced|  my_image: node:prefixed",
  ),
  file("tab-indentation", "build:|\timage:|\t\tname: node:22|\tscript: x"),
  file("default-image", "default:|  image: node:22|  services:|    - redis:7|job:|  script: x"),
  file(
    "two-images-second-unpinned",
    `a:|  image: node${D}|b:|  image: python:3.12|c:|  image: golang${D}|d:|  image: rust:1`,
  ),

  // the long form and the block state machine
  file(
    "long-form-name",
    "build:|  image:|    name: node:22|    entrypoint: [/bin/sh]|  script: x|  other:|    name: ignored:1",
  ),
  file("long-form-pinned", `build:|  image:|    name: node${D}|    entrypoint: [""]`),
  file(
    "long-form-quoted-name",
    `build:|  image:|    name: "node:22"|    name: 'node:23'|    name: ""|    name: "node:24|    name: $VAR|    name: $VAR:tag`,
  ),
  file("long-form-name-shapes", "build:|  image:|    name: node:22 extra|    name:|    name: # c"),
  file("name-outside-block", "build:|  name: node:22|  - name: node:23|  stage: x|name: node:24"),
  file(
    "block-closed-by-dedent",
    "build:|  image:|    name: node:22|  name: after:dedent|test:|  name: other:job",
  ),
  file(
    "block-same-indent-closes",
    "image:|  name: a:1|name: b:2|image:|  name: c:3|stage: x|name: d:4",
  ),
  file(
    "block-deeper-continues",
    "build:|  image:|    name: a:1|    extra:|      name: b:2|      - c:3",
  ),
  file(
    "block-comments-and-blanks",
    "build:|  image:|# a comment at column zero||    # indented comment|   |    name: node:22|  # shallow comment|    name: node:23",
  ),
  file(
    "block-comment-line-closes",
    "build:|  image:|    name: a:1|  # shallow comment|    name: b:2",
  ),
  file("image-reopens-block", "a:|  image:|    name: x:1|  image:|    name: y:2|  image: z:3"),
  file(
    "inline-image-opens-no-block",
    "a:|  image: node:22|    name: not:inblock|  services:|    - s:1",
  ),

  // services
  file(
    "services-forms",
    `build:|  services:|    - redis|    - postgres:16|    - mysql${D}|    - name: mongo:7|      alias: db|    - name: nginx|    - name: cache${D}|    -   spaced:1|  script: x|  - after:services`,
  ),
  file(
    "services-name-without-dash",
    "build:|  services:|    name: redis:7|    alias: r|    - other:1",
  ),
  file(
    "services-quoted",
    `build:|  services:|    - "redis:7"|    - 'pg:16'|    - "a b"|    - ""|    - ''|    - name: "x:1"|    - $SVC|    - $SVC:1`,
  ),
  file(
    "services-comments",
    "build:|  services:|    # redis:7|    - redis:7 # cache|    - # only a comment|    -|    - name: pg:16 # db|    -   # x",
  ),
  file(
    "services-opener-shapes",
    "build:|  services:   |    - redis:7|  services: [redis:7]|    - ignored:1",
  ),
  file(
    "services-closed-by-sibling",
    "build:|  services:|    - redis:7|  tags:|    - runner-a|    - name: not:service",
  ),
  file(
    "services-then-image-block",
    "build:|  services:|    - redis:7|  image:|    name: node:22|    - not:service|  services:|    - pg:16",
  ),
  file(
    "services-top-level",
    "services:|  - redis:7|  - name: pg:16|image: top:1|services:|- dedent:1",
  ),
  file(
    "services-tab-indentation",
    "build:|\tservices:|\t\t- redis:7|\t\t- name: pg:16|\tscript: x",
  ),
  file("services-flow-sequence", "build:|  services: [redis:7, pg:16]|  services: |    - mysql:8"),
];
