---
id: "0042"
slug: widget-csv-export
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 77
version: 1.0.0
---

# Widget CSV export

## Intent

Support teams can obtain the list of widgets they are allowed to see as a CSV file that opens in a spreadsheet, through a new `widgets export` command, and can trust that a file at the requested path is always complete and usable.

## Requirements

1. The CLI SHALL provide a `widgets export` command that takes a required `--out <path>` option naming the file to write.
2. The command SHALL write every widget visible to the caller, one row per widget, and SHALL NOT include widgets the caller cannot see.
3. The file SHALL be comma-separated UTF-8 text whose first line is the header row `id,name,owner,created_at`, with the columns in that order.
4. Field values containing a comma, a double quote or a line break SHALL be quoted so that a spreadsheet reads each widget as exactly one row with four fields.
5. When the caller can see no widgets, the command SHALL write a file containing only the header row and SHALL exit with a success status.
6. When the export fails for any reason (service error, authentication failure, unwritable path), the command SHALL print a clear error message that names the cause, SHALL exit with a non-zero status, and SHALL leave no file at the `--out` path that was not there complete before the command ran.
7. When a file already exists at the `--out` path and the export fails, the command MUST leave that existing file unchanged.
8. When `--out` is omitted, the command SHALL print a usage error naming the missing option, SHALL exit with a non-zero status and SHALL write no file.
9. When the export succeeds, the command SHALL exit with a success status and the file at `--out` SHALL contain all rows.
10. `widgets list` SHALL keep its current text-table output.

## Scenarios

### Happy path: export visible widgets

- **Given** the caller can see three widgets
- **When** they run `widgets export --out widgets.csv`
- **Then** `widgets.csv` exists, is UTF-8, has the header `id,name,owner,created_at` followed by three rows, and the command exits with success.

### Happy path: name containing a comma

- **Given** a visible widget named `Gear, large`
- **When** the caller exports it
- **Then** the name is quoted and the row still has four fields when read as CSV.

### Empty result

- **Given** the caller can see no widgets
- **When** they run `widgets export --out widgets.csv`
- **Then** the file contains only the header row and the command exits with success.

### Failure path: service error mid-export

- **Given** the widgets service fails after part of the list has been retrieved
- **When** the caller runs `widgets export --out widgets.csv` and no such file existed
- **Then** the command prints an error naming the cause, exits non-zero, and no file exists at `widgets.csv`.

### Failure path: existing file preserved

- **Given** `widgets.csv` already exists with prior content
- **When** an export to that path fails
- **Then** the prior content is unchanged and the command exits non-zero with a clear error.

### Failure path: unwritable path

- **Given** the directory of the `--out` path does not exist or is not writable
- **When** the caller runs the command
- **Then** it prints an error naming the path, exits non-zero and creates no file.

### Failure path: missing option

- **Given** the caller omits `--out`
- **When** they run `widgets export`
- **Then** a usage error is printed, the exit status is non-zero and no file is written.

## Out of scope

- Other formats (JSON, XLSX) and other delimiters.
- Extra columns, column selection, filtering, sorting or date-range options.
- Writing to standard output when `--out` is absent.
- Changes to `widgets list`.
- Exporting resources other than widgets.

## Open questions

- [AUTO-PARKED] Overwrite behaviour: the ticket does not say whether a successful export may replace an existing file at `--out` silently or requires a flag. Draft assumption: it replaces it, and requirement 7 protects the old file only on failure.
- [AUTO-PARKED] Format of `created_at` (for example ISO 8601 in UTC) is not specified; the spreadsheet use suggests a single unambiguous format.
- [AUTO-PARKED] Row order is not specified (service order versus sorted by `id`).
- [AUTO-PARKED] Spreadsheet formula injection: whether values beginning with `=`, `+`, `-` or `@` must be neutralised is not stated, and doing so alters the data.
- [AUTO-PARKED] "Every widget the caller can see" is assumed to include widgets across all pages of the service's results; the size at which this becomes a problem is unknown.
