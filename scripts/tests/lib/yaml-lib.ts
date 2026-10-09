// yaml-lib.ts — the real `js-yaml` behind `scripts/lib/yaml-text.ts`, for suites.
//
// The build modules never import `js-yaml` (spec 0250 R24): the entry loads it
// through `loadDependency` and injects it. Until the dependency moves to
// `dependencies` (a later PR), `loadDependency` would refuse it here, so the
// suites load the package with a plain dynamic import and narrow it with the
// same `toYamlLib` the build uses. The real package, never a stub: a suite that
// runs against a fake proves nothing about the schemas.

import {
  createYamlText,
  toYamlLib,
  type YamlDoc,
  type YamlLib,
  type YamlText,
} from "../../lib/yaml-text.ts";

const namespace: unknown = await import("js-yaml");

/** The narrowed real `js-yaml` namespace. */
export const yamlLib: YamlLib = toYamlLib(namespace);

/** The readers over {@link yamlLib}. */
export const yamlText: YamlText = createYamlText(yamlLib);

/** `parse` that fails the test, naming the source, when it returns `null`. */
export function docOf(text: string): YamlDoc {
  const doc = yamlText.parse(text);
  if (doc === null) throw new Error(`expected a parseable YAML source: ${JSON.stringify(text)}`);
  return doc;
}
