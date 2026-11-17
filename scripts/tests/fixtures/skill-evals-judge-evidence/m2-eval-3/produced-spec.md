---
id: "0042"
slug: widget-csv-export
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 77
version: 1.0.0
---

# Widget CSV export

## Intent

Support teams need to open the list of widgets in a spreadsheet. The
`widgets` command-line client gains an `export` command that writes the
widgets the caller can see to a CSV file the team can open directly, with a
header row. A file that cannot be opened is worse than no file, so a failed
export yields a clear error and no file.

## Requirements

1. The client SHALL provide a `widgets export` command that writes one CSV row per widget the caller can see.
2. The command SHALL take the destination file path through `--out <path>`, and MUST report a clear usage error, writing no file, when `--out` is absent.
3. The CSV file SHALL be comma-separated, UTF-8 encoded, and SHALL start with a header row.
4. The header row SHALL contain exactly the columns `id`, `name`, `owner` and `created_at`, in that order, and every data row SHALL carry those four values in the same order.
5. Field values containing a comma, a double quote or a line break SHALL be quoted so that the file opens in a spreadsheet with one row per widget.
6. When the caller can see no widgets, the command SHALL write a file containing only the header row and exit successfully.
7. If the widgets service fails at any point before the export is complete, the command MUST exit with a non-zero status and a clear error message, and MUST NOT leave a partial or half-written file at the `--out` path.
8. When the export fails and a file already existed at the `--out` path, the command SHALL leave that earlier file unchanged.
9. On success the exported file SHALL open in a spreadsheet application with the header row as its first row.

## Scenarios

### Happy path: export of several widgets

- **Given** the caller can see three widgets
- **When** the caller runs `widgets export --out widgets.csv`
- **Then** `widgets.csv` exists, is UTF-8 and comma-separated, its first row is `id,name,owner,created_at`, and it has three data rows, one per widget
- **And** the file opens in a spreadsheet with the header row as the first row.

### Happy path: no visible widgets

- **Given** the caller can see no widgets
- **When** the caller runs `widgets export --out widgets.csv`
- **Then** `widgets.csv` contains only the header row and the command exits with status 0.

### Failure path: service fails

- **Given** the widgets service returns an error during the export
- **When** the caller runs `widgets export --out widgets.csv`
- **Then** the command prints a clear error message and exits non-zero
- **And** no `widgets.csv` file exists at that path.

### Failure path: service fails with an existing file

- **Given** `widgets.csv` already exists and the widgets service fails during the export
- **When** the caller runs `widgets export --out widgets.csv`
- **Then** the command exits non-zero with a clear error message and `widgets.csv` is unchanged.

### Failure path: missing `--out`

- **Given** the caller omits `--out`
- **When** the caller runs `widgets export`
- **Then** the command prints a usage error, exits non-zero and writes no file.

## Out of scope

- Output formats other than CSV.
- Changes to the existing `widgets list` text table.
- Columns beyond `id`, `name`, `owner` and `created_at`.
- Filtering, sorting or pagination options for the export.

## Open questions

- [USER-PARKED] Do widgets archived by their owner belong in the export? Undecided by the requester, who could not decide it at authoring time. Until it is resolved, requirement 1 ("widgets the caller can see") is silent on archived widgets, and neither inclusion nor exclusion is specified. Resolve before approval by rewriting it as a requirement, scenario or out-of-scope bullet.
