---
id: "0042"
slug: widget-csv-export
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 77
version: 1.0.0
---

# Export widgets as CSV

## Intent

Support teams can save the widgets they can see into a CSV file that opens in a
spreadsheet.

## Requirements

1. **R1.** `widgets export --out <path>` SHALL write one CSV row per visible
   widget, preceded by a header row with the columns `id`, `name`, `owner` and
   `created_at`.
2. **R2.** The file SHALL be comma-separated and encoded in UTF-8.
3. **R3.** When the export fails, the command SHALL exit non-zero, print the
   reason and leave no partial file at `<path>`.

## Scenarios

### Happy path

- **Given** three visible widgets,
- **When** the user runs `widgets export --out w.csv`,
- **Then** `w.csv` holds a header row and three data rows.

### Failure path

- **Given** the widgets service is unreachable,
- **When** the user runs `widgets export --out w.csv`,
- **Then** the command exits non-zero, prints the reason and no `w.csv` exists.

## Out of scope

- Other formats such as JSON.

## Open questions
