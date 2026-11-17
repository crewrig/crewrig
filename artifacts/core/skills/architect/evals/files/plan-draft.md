## PLAN — issue #77 (spec 0042)

### Approach

Replace the polling loop of the sync agent by a webhook receiver.

### Steps

1. Add a receiver to the agent.
2. Update the configuration so that the agent registers the webhook.
3. Remove the old polling code once the webhook works.

### Blast radius

- The sync agent and its configuration.
