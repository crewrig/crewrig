# Context: config lookups

Three services (`billing`, `catalog`, `notifier`) read the same 40 KB of tenant configuration from
the `config-api` service on every request. `config-api` handles about 900 requests per second at
peak and its p99 latency has doubled in a month. The configuration changes a few times a day and a
change must reach every service within 60 seconds. The team has two engineers and a release freeze
in three weeks. Nobody may add a new datastore this quarter.
