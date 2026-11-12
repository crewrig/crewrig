# widgets: notes for the README

widgets is a command-line client for the Acme widgets service. The audience of the README is
outside developers who integrate it into their own scripts; they have no access to our repository.

- Install: `npm install -g @acme/widgets` (needs Node.js 20 or later).
- First run: `widgets login` stores a token in `~/.config/widgets/token`.
- Most common commands:
  - `widgets list` prints the widgets the token can see.
  - `widgets get <id>` prints one widget as JSON.
  - `widgets create --name <name>` creates a widget and prints its id.
- Exit codes: 0 success, 1 the service refused the call, 2 usage error.
- Full API reference: https://docs.acme.example/widgets
- Contributing: see CONTRIBUTING.md in the repository.
- License: MIT.
