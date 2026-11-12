# What I did

I refactored the retry logic in the widget client: the fixed delay became exponential backoff
with jitter, and the retry count moved from a constant to a setting. All tests pass.
