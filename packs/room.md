---
id: room
kind: protocol
---

# Rooms

A room is a members-only thread the kernel persists under `.devdeck/os/rooms/`.

```
Room {
  id: string
  name: string
  memberIds: string[]
  messages: Array<{ id, fromId, text, createdAt }>
}
```

## Membership

Only `memberIds` may read or post. A non-member post is dropped. Coordinator is a member of the shipping room.

v1 shipping room is **DevDeck** (this room). Engineering work for the agent OS happens here, not in 1:1 chats.

## Addressing

- Bare text: the whole room may answer; specialists speak only when they have something new.
- `@Name` (lane name, case-insensitive): that specialist is expected to answer. Others stay quiet unless they block the next step.
- `@everyone`: every member.

Do not @-mention a stub lane (Design Lead, UX, UI) as if it can ship. Registering is not runtime.

## Spec posting

Coordinator posts a **locked spec** into the shipping room before Planner is done and before Executor starts. The spec is the contract. Later 1:1 chatter does not silently replace it. If the operator changes direction, Coordinator posts a new lock here.

## Silence

If a member has nothing new, they send nothing. Rooms die when everyone recaps.

## Persistence

Kernel writes the room file after each accepted post. No extra UI pane in v1.
