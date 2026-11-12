# Issue 77: Export widgets as CSV

Repository: example/widgets (a small command-line client for the widgets service).

## Body

Support teams want to open the list of widgets in a spreadsheet. Today
`widgets list` prints a text table only.

Add a `widgets export` command that writes every widget the caller can see to a
CSV file, one row per widget, with the columns `id`, `name`, `owner` and
`created_at`. The file path is given with `--out <path>`.

## Comments

- Support lead: "A file we cannot open is worse than no file. If something goes
  wrong I want a clear error and no half-written file."
- Maintainer: "Keep the format simple: comma-separated, header row, UTF-8."
