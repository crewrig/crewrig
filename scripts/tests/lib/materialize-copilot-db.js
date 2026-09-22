#!/usr/bin/env node
// materialize-copilot-db.js — materializes a copilot-cli fixture's
// schema.sql + rows.sql into a temp sqlite DB via node:sqlite's exec()
// (PLAN v3 step 17 — no binary blob committed to git).
//
// Usage:
//   node materialize-copilot-db.js <fixtureDir> <outDbFile>

'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function main() {
  const [fixtureDir, outDbFile] = process.argv.slice(2);
  if (!fixtureDir || !outDbFile) {
    console.error('Usage: node materialize-copilot-db.js <fixtureDir> <outDbFile>');
    process.exit(2);
  }
  const schema = fs.readFileSync(path.join(fixtureDir, 'schema.sql'), 'utf8');
  const rows = fs.readFileSync(path.join(fixtureDir, 'rows.sql'), 'utf8');

  if (fs.existsSync(outDbFile)) fs.unlinkSync(outDbFile);
  const db = new DatabaseSync(outDbFile);
  try {
    db.exec(schema);
    db.exec(rows);
  } finally {
    db.close();
  }
}

main();
