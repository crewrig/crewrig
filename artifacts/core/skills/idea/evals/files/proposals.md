# Proposals received on session issue 88 (parent issue 80: reduce CI time)

Parent issue 80: "CI takes 40 minutes; bring it under 15."

## Proposal: Shard the test suite

**Submitter:** alice

### Summary
Split the test suite into 8 shards that run in parallel on separate runners.

### Rationale
Test execution is 70 percent of the pipeline time.

### Trade-offs
More runners cost more; flaky-test isolation gets harder.

### Open questions
Does the runner pool have capacity for 8 shards?

## Proposal: Parallel test shards

**Submitter:** bob

### Summary
Run the tests in 8 parallel shards, one per runner, to cut the wall-clock time.

### Rationale
Most of the pipeline is test execution.

### Trade-offs
Needs more runner capacity.

### Open questions
Shard balancing.

## Proposal: Rewrite the build in Rust

**Submitter:** carol

### Summary
Rewrite the whole application in Rust so that it compiles faster.

### Rationale
Rust is fast.

### Trade-offs
Takes a year; the whole team must learn Rust.

### Open questions
Everything.

## Proposal: Cache dependencies between runs

**Submitter:** dave

### Summary
Restore the dependency directory from a cache keyed on the lockfile hash.

### Rationale
Dependency installation takes 9 of the 40 minutes.

### Trade-offs
Cache invalidation bugs can hide broken lockfiles.

### Open questions
None.
