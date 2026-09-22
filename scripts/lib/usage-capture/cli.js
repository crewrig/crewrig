#!/usr/bin/env node
// cli.js — the Node entry point hooks/usage-capture.sh invokes on its slow
// path (PLAN v3 step 10). Reads the payload from --payload-file <path>,
// NEVER from stdin (the shim already consumed stdin to decide the fast
// path), and writes nothing to stdout — the shim redirects both streams to
// /dev/null regardless, so this is belt-and-suspenders, not load-bearing.
//
// Usage:
//   node scripts/lib/usage-capture/cli.js --cli <cli> --event <event> --payload-file <path>

'use strict';

const fs = require('fs');
const dispatcher = require('./index');

function parseArgs(argv) {
  const args = { cli: null, event: null, payloadFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--cli':
        args.cli = argv[i + 1];
        i += 1;
        break;
      case '--event':
        args.event = argv[i + 1];
        i += 1;
        break;
      case '--payload-file':
        args.payloadFile = argv[i + 1];
        i += 1;
        break;
      default:
        break;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let payload = {};
  if (args.payloadFile) {
    try {
      const raw = fs.readFileSync(args.payloadFile, 'utf8');
      payload = JSON.parse(raw);
    } catch (err) {
      // An unreadable or malformed payload file still reaches the
      // dispatcher's own try/catch via a deliberately empty payload — the
      // adapter's own shape assertion (R17) turns that into an uncaptured
      // record naming the mismatch, never a crash that could leak node's
      // own exit status back to the shim (R15 is the shim's job, but this
      // keeps the surface small either way).
      payload = {};
    }
  }

  dispatcher.capture({ cli: args.cli, event: args.event, payload });
}

main();
