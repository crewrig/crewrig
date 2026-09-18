#!/usr/bin/env node
// usage-record-validator.js — validate usage records against
// schemas/usage-record/v1.schema.json (spec 0205) and recompute recordId.
//
// Usage: node scripts/lib/usage-record-validator.js <file.json> [<file.json> ...]
//
// For each file, two independent checks run:
//   - schema:     the record validates against v1.schema.json.
//   - derivation: recordId equals sha256(identity.sessionId + U+001F +
//                 idempotencyKey), lowercase hex (R22). Only checked once
//                 the record has already passed the schema check, since the
//                 digest inputs must exist and be strings first.
//
// Exit codes: 0 clean, 1 one or more files failed a check, 2 usage or
// preflight fault (missing dependency, missing file, unparsable JSON).

'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schemas', 'usage-record', 'v1.schema.json');
const UNIT_SEPARATOR = '';

let Ajv2020;
let addFormats;
try {
    Ajv2020 = require('ajv/dist/2020');
    addFormats = require('ajv-formats');
} catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
        console.error('FATAL: ajv / ajv-formats not installed — run `npm install` first.');
        process.exit(2);
    }
    throw err;
}

function deriveRecordId(record) {
    const sessionId = record && record.identity && record.identity.sessionId;
    const idempotencyKey = record && record.idempotencyKey;
    return createHash('sha256').update(`${sessionId}${UNIT_SEPARATOR}${idempotencyKey}`).digest('hex');
}

function main() {
    const files = process.argv.slice(2);
    if (files.length === 0) {
        console.error('Usage: node scripts/lib/usage-record-validator.js <file.json> [<file.json> ...]');
        process.exit(2);
    }

    let schema;
    try {
        schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    } catch (err) {
        console.error(`FATAL: could not read/parse schema at ${SCHEMA_PATH}: ${err.message}`);
        process.exit(2);
    }

    // strictRequired is disabled: v1.schema.json's conditional allOf/if/then
    // blocks list `required` properties (e.g. modelId, rawStatus) that are
    // declared once in the root `properties`, not re-declared locally in
    // each branch — ajv's strictRequired check cannot see across that
    // allOf/if/then boundary and would otherwise flag every one as a typo.
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    let anyFailed = false;

    for (const file of files) {
        let record;
        try {
            record = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (err) {
            console.error(`${file}: could not read/parse JSON: ${err.message}`);
            process.exit(2);
        }

        const valid = validate(record);
        if (!valid) {
            anyFailed = true;
            for (const error of validate.errors) {
                console.error(`${file}: schema ${error.instancePath || '/'} ${error.message}`);
            }
            continue;
        }

        const expected = deriveRecordId(record);
        const found = record.recordId;
        if (found !== expected) {
            anyFailed = true;
            console.error(`${file}: recordId mismatch (expected ${expected}, found ${found})`);
            continue;
        }

        console.log(`${file}: OK`);
    }

    process.exit(anyFailed ? 1 : 0);
}

main();
