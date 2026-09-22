// checkout.js — checkoutRootFor(projectRoot), the one resolver every side
// keys on (spec 0208 PLAN v3 step 2). A bounded upward walk from
// realpathSync(projectRoot) to the first ancestor holding `.git` as a file
// or a directory, capped at 32 levels, memoized on the normalized argument
// in a module-level Map as layout.js's wingMemo() is — one module is one
// memo and one normalization, so the declaration writer, the declaration
// reader and usage-capture/attribution.js's channel 3 cannot drift into two
// different strings for the same checkout.
//
// Normalization is realpath, load-bearing: /tmp and /private/tmp are the
// same directory and hash differently, and mktemp -d returns the former
// while this walk returns the latter.

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_LEVELS = 32;
const memo = new Map();

function hasGit(dir) {
  try {
    fs.statSync(path.join(dir, '.git'));
    return true;
  } catch (err) {
    return false;
  }
}

// realpathOrSelf(p) — the same normalization checkoutRootFor() applies,
// exposed so a caller with no ancestor within the cap keys its own fallback
// (a project-scoped declaration, or channel 3's checkout-root argument) on
// the identical string this module would have used.
function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch (err) {
    return p;
  }
}

function checkoutRootFor(projectRoot) {
  let real;
  try {
    real = fs.realpathSync(projectRoot);
  } catch (err) {
    return null;
  }

  if (memo.has(real)) return memo.get(real);

  let dir = real;
  let found = null;
  for (let i = 0; i < MAX_LEVELS; i++) {
    if (hasGit(dir)) {
      found = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root reached
    dir = parent;
  }

  memo.set(real, found);
  return found;
}

module.exports = { checkoutRootFor, realpathOrSelf };
