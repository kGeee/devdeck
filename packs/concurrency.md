---
id: concurrency
kind: contract
---

# Concurrency

There is no global mutex and no lock table in the database. Three contracts, plus exclusive resources beside them.

## run-lock

One active turn per chat.

- When a turn is running, inbound messages do not open a second turn.
- The kernel either **queues** the inbound (it runs after the current turn ends) or **steers** it into the live turn (it becomes extra instruction for the same run).
- Queue vs steer: steer if the inbound is a correction, stop, or extra constraint on the work already in flight. Queue if it is a new ask.
- A chat with no active turn starts one.

Kernel shape:

```
RunLock {
  chatId: string
  status: "idle" | "active"
  activeTurnId?: string
  inbound: Array<{ id, text, arrivedAt, mode: "queue" | "steer" }>
}
```

No SQL lock. The chat record holds the flag.

## approval-gate

One approval card at a time, per stream.

- A stream that needs a human allow/deny **pauses**. It does not keep mutating.
- The next card in that stream is not shown until the open one is allowed or denied.
- Allow resumes the same stream. Deny ends that action; the stream may continue only with a safer path or a new ask.
- Other chats are not blocked by this chat's card.

Kernel shape:

```
ApprovalGate {
  streamId: string
  card: null | { id, summary, createdAt }
  streamStatus: "running" | "paused"
}
```

## shard-writer

Memory files are single-writer.

- One agent owns one shard path. Another agent never writes that file.
- Profile, dated log, and project shard for agent A are A-only.
- Cross-agent facts go through the ledger (agent-log-db) or a room message, not a shared file write.

Kernel shape:

```
ShardWriter {
  path: string
  ownerAgentId: string
}
```

Refuse a write when `callerId !== ownerAgentId`.

## Exclusive resources (beside the three)

Not a fourth lock type in the table. Just occupancy:

- One driver per desktop.
- One writer per CodeJob branch (Executor owns it until the PR exists).

If the resource is busy, wait or reject. Do not invent a mutex row.

## Loader notes

`lib/os/` exposes types + queue/steer + pause. Do not add a `locks` table. Do not wrap agent-log-db in a lock.
