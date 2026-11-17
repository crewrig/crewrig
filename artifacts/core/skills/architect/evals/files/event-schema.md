# Context: the order event schema

Orders are published as events on a shared bus and consumed by five teams. Schema v1 stores the
amount as a decimal string; teams have asked for integer minor units because rounding bugs cost
money twice this year. Consumers are written in three languages and are deployed independently.
Once v2 events are on the bus and old events are purged after 30 days, v1 cannot be rebuilt.
