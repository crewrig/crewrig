// tls-env-quote.ts — quote one value as a shell word for `~/.crewrig/tls-env.sh`
// (spec 0256 requirement 19, decision D1).
//
// The word must be accepted by the shell (`.`) and by the reader in tls-env.ts,
// and for printable ASCII it follows Bash's `printf %q`, MEASURED rather than
// copied (scripts/tests/fixtures/setup-tls/printf-q-alphabet.json.golden):
//   - bare: `A-Za-z0-9` and `_ @ % + = : . / -`; also `#` and `~` when they are
//     not the first character. Notably `,` and `^` are NOT bare: `%q` writes
//     `\,` and `\^`;
//   - `~` is also escaped right after `:` or `=` (Bash 5 does; Bash 3.2, the
//     macOS `/bin/bash`, leaves `:~` bare and then tilde-expands it when the
//     file is sourced, so the safe behaviour is the one that is written);
//   - every other printable ASCII character, space included, gets a backslash;
//   - a control character, a newline, DEL and every byte of a non-ASCII
//     character is written as a `$'...'` string of three-digit octal escapes
//     (non-ASCII as its UTF-8 bytes: Bash 5 in the C locale writes the same,
//     and the reader decodes the bytes back to the identical character);
//   - the empty value is `''`; a word is never single-quoted otherwise;
//   - a NUL, or a string that is not well-formed UTF-16, is rejected.
//
// Standard library only: this file is bundled with tls-env.ts.

const BARE = /[A-Za-z0-9_@%+=:./-]/;

function isBareAt(ch: string, previous: string | undefined): boolean {
  if (BARE.test(ch)) return true;
  if (previous === undefined) return false;
  if (ch === "#") return true;
  return ch === "~" && previous !== ":" && previous !== "=";
}

/** Quote `value` as one shell word that tls-env.ts reads back identically. */
export function quoteWord(value: string): string {
  if (value.includes("\0"))
    throw new Error("tls-env: a NUL byte cannot be written in a shell word");
  // with the `u` flag only a lone surrogate matches `\p{Surrogate}`
  if (/\p{Surrogate}/u.test(value))
    throw new Error("tls-env: the value is not well-formed Unicode");
  if (value === "") return "''";
  let out = "";
  let previous: string | undefined;
  let octal = "";
  const flush = (): void => {
    if (octal !== "") out += `$'${octal}'`;
    octal = "";
  };
  for (const ch of value) {
    const code = ch.codePointAt(0) as number;
    if (code < 0x20 || code >= 0x7f) {
      for (const byte of Buffer.from(ch, "utf8")) octal += `\\${byte.toString(8).padStart(3, "0")}`;
    } else {
      flush();
      out += isBareAt(ch, previous) ? ch : `\\${ch}`;
    }
    previous = ch;
  }
  flush();
  return out;
}
