// path-scrub.ts — replace a real path by a placeholder only where it is a whole path prefix:
// a short root such as the golden container's `/w` must not rewrite `/web-tester`.

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `real` followed by anything but a name character (or the end) becomes `name`. */
export const scrubPath = (text: string, real: string, name: string): string =>
  real === "" ? text : text.replace(new RegExp(`${escape(real)}(?![A-Za-z0-9._-])`, "g"), name);
