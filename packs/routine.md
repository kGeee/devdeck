---
id: routine-schema
kind: schema
---

# Routine schema

A routine is a saved intent plus a trigger. It runs while the operator is away.

```
Routine {
  id: string
  name: string
  prompt: string          // intent, not a frozen tool call
  enabled: boolean
  trigger: CronTrigger | EventTrigger
  expiresAt?: string      // finite watch
}
```

Persist under `.devdeck/os/routines/`.

## Prompt

Write what to do, not which function to call. Tool names and schemas change; the intent should still make sense. Example: "Check open PRs on the shipping repo and post a one-line status to the DevDeck room if anything is blocked."

## Cron

Five-field cron in the operator's local zone.

Default window: weekday daytime. Overnight and weekend fires need a stated reason (it only happens then, it is time-critical, or it is a personal habit). Do not save `@hourly` / `@daily` as a substitute for a bounded weekday window.

## Event

One concrete target. No wildcards.

v1 shapes:

- `github`: `{ type: "github", repo: "owner/name", events: [...], pr?: number }`
- `cron`: `{ type: "cron", schedule: "m h dom mon dow" }`

A PR-scoped github routine that lists a terminal event (`pr-merged` or `pr-closed`) deletes itself after that wake. Other finite watches set `expiresAt` and the kernel deletes them when the date passes or the condition hits.

## Finite vs standing

Standing: daily digest, repo subscription the operator asked to keep.

Finite: "watch this PR", "ping me when X". Self-delete. Default to finite unless they asked for ongoing.

## Concurrency

A routine wake is a turn. It takes the run-lock on its chat (or the shipping room). It respects approval-gate. It writes only its own memory shard.
