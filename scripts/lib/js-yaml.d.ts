// Ambient types for js-yaml (a devDependency): only `load` is used, so strict
// typing holds without adding @types/js-yaml to package.json (spec 0147 delta-01).
declare module "js-yaml" {
  export function load(input: string): unknown;
}
