---
id: "0042"
slug: widget-csv-export
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 77
version: 1.0.0
---

# Export widgets as CSV

## Intent

Support teams want to open the list of widgets in a spreadsheet. A `widgets export` command gives them every widget the caller can see as a CSV file that a spreadsheet opens with a header row, and it never leaves a file that cannot be opened: when the widgets service fails, the user gets a clear error and no file.

## Requirements

1. The `widgets export` command SHALL accept the file path through `--out <path>` and SHALL write the CSV file to that path.
2. The file SHALL contain one row per widget the caller can see, and no row for a widget the caller cannot see.
3. The file SHALL start with a header row whose columns are, in order, `id`, `name`, `owner` and `created_at`; each widget row SHALL carry its values in the same column order.
4. The file SHALL be comma-separated and encoded in UTF-8.
5. A value containing a comma, a double quote or a line break SHALL be written so that a spreadsheet reads it back as a single cell with its original content.
6. When the caller can see no widget, the command SHALL still write a file containing only the header row and SHALL report success.
7. When the widgets service fails, the command MUST report a clear error that states the failure, MUST exit with a non-zero status, and MUST NOT leave a partial file at the `--out` path; any file already present at that path before the call SHALL remain unchanged.
8. When `--out` is missing, the command MUST report a clear usage error, MUST exit with a non-zero status and MUST NOT write any file.
9. The existing `widgets list` text table SHALL keep its current behaviour.

## Scenarios

### Happy path: widgets exported

- **Given** the caller can see three widgets,
- **When** the caller runs `widgets export --out widgets.csv`,
- **Then** `widgets.csv` exists, a spreadsheet opens it with a header row `id,name,owner,created_at` followed by three widget rows, and the command exits with status zero.

### Happy path: no visible widget

- **Given** the caller can see no widget,
- **When** the caller runs `widgets export --out widgets.csv`,
- **Then** `widgets.csv` contains only the header row and the command exits with status zero.

### Happy path: awkward characters

- **Given** a visible widget whose name contains a comma and a double quote,
- **When** the caller exports the widgets,
- **Then** a spreadsheet shows that name in a single cell, unchanged.

### Failure path: service failure

- **Given** the widgets service fails while the widgets are being retrieved,
- **When** the caller runs `widgets export --out widgets.csv`,
- **Then** the command prints a clear error, exits with a non-zero status, and no `widgets.csv` exists (or, if one existed before, it is unchanged).

### Failure path: missing path

- **Given** the caller omits `--out`,
- **When** the caller runs `widgets export`,
- **Then** the command prints a usage error, exits with a non-zero status and writes no file.

## Out of scope

- Output formats other than CSV, and options to choose the columns, the separator or the encoding.
- Filtering or sorting the exported widgets.
- Changes to `widgets list`.
- Writing the export to standard output.

## Open questions

- [USER-PARKED] Do widgets archived by their owner belong in the export? Undecided by the requester at drafting time; Requirement 2 ("every widget the caller can see") does not settle it. To be resolved before implementation, then rewritten as a requirement or an out-of-scope bullet.
- When a file already exists at the `--out` path and the export succeeds, should the command overwrite it, or refuse and ask for another path? The ticket and the interview are silent; Requirement 7 only covers the failure case.
