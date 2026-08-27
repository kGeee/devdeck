import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getLaneByName } from "./pack-loader";
import { roomsDir } from "./paths";
import type {
  LaneDef,
  MentionTarget,
  Room,
  RoomMessage,
} from "./types";
import { COORDINATOR_LANE_ID, SHIPPING_ROOM_NAME } from "./types";

const MENTION_RE = /@([A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_-]*)?)/g;

async function ensureRoomsDir(cwd: string): Promise<string> {
  const dir = roomsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function roomPath(roomId: string, cwd: string): string {
  return path.join(roomsDir(cwd), `${roomId}.json`);
}

export async function saveRoom(room: Room, cwd = process.cwd()): Promise<void> {
  await ensureRoomsDir(cwd);
  await fs.writeFile(roomPath(room.id, cwd), JSON.stringify(room, null, 2), "utf8");
}

export async function loadRoom(
  roomId: string,
  cwd = process.cwd()
): Promise<Room | null> {
  try {
    const raw = await fs.readFile(roomPath(roomId, cwd), "utf8");
    return JSON.parse(raw) as Room;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

export async function openRoom(
  opts: { id?: string; name: string; memberIds: string[] },
  cwd = process.cwd()
): Promise<Room> {
  const id = opts.id ?? slugify(opts.name);
  const existing = await loadRoom(id, cwd);
  if (existing) {
    const members = new Set([...existing.memberIds, ...opts.memberIds]);
    existing.memberIds = [...members];
    await saveRoom(existing, cwd);
    return existing;
  }
  const room: Room = {
    id,
    name: opts.name,
    memberIds: [...new Set(opts.memberIds)],
    messages: [],
  };
  await saveRoom(room, cwd);
  return room;
}

/** Seed/open the shipping room with Coordinator as a member. */
export async function openShippingRoom(
  cwd = process.cwd()
): Promise<Room> {
  return openRoom(
    {
      id: "devdeck",
      name: SHIPPING_ROOM_NAME,
      memberIds: [COORDINATOR_LANE_ID],
    },
    cwd
  );
}

export type PostResult =
  | { ok: true; message: RoomMessage; room: Room }
  | { ok: false; reason: "not-member" };

export async function postToRoom(
  roomId: string,
  fromId: string,
  text: string,
  cwd = process.cwd()
): Promise<PostResult> {
  const room = await loadRoom(roomId, cwd);
  if (!room) throw new Error(`room not found: ${roomId}`);
  if (!room.memberIds.includes(fromId)) {
    return { ok: false, reason: "not-member" };
  }
  const message: RoomMessage = {
    id: randomUUID(),
    fromId,
    text,
    createdAt: new Date().toISOString(),
  };
  room.messages.push(message);
  await saveRoom(room, cwd);
  return { ok: true, message, room };
}

/**
 * Parse @mentions. Multi-word lane names (e.g. Design Lead) are matched
 * greedily against the registry when possible.
 */
export function parseMentions(
  text: string,
  lanes: Map<string, LaneDef>
): MentionTarget[] {
  const targets: MentionTarget[] = [];
  const seen = new Set<string>();

  // Prefer matching known lane names (including multi-word) before falling back.
  for (const lane of uniqueLanes(lanes)) {
    const re = new RegExp(`@${escapeRegExp(lane.name)}\\b`, "gi");
    if (re.test(text)) {
      const key = `lane:${lane.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({
          kind: "lane",
          laneId: lane.id,
          name: lane.name,
          runtime: lane.runtime,
        });
      }
    }
  }

  if (/@everyone\b/i.test(text) && !seen.has("everyone")) {
    seen.add("everyone");
    targets.push({ kind: "everyone" });
  }

  // Capture leftover @tokens that did not match a lane.
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text))) {
    const raw = m[1];
    if (raw.toLowerCase() === "everyone") continue;
    if (getLaneByName(lanes, raw)) continue;
    // Skip if already covered as part of a multi-word lane match.
    const already = targets.some(
      (t) =>
        t.kind === "lane" &&
        t.name.toLowerCase().startsWith(raw.toLowerCase())
    );
    if (already) continue;
    const key = `unknown:${raw.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ kind: "unknown", raw });
  }

  return targets;
}

/** Who should answer this post. Stub lanes are listed but not runnable. */
export function routeTargets(
  text: string,
  room: Room,
  lanes: Map<string, LaneDef>
): { expected: LaneDef[]; stubMentions: LaneDef[]; everyone: boolean } {
  const mentions = parseMentions(text, lanes);
  const everyone = mentions.some((m) => m.kind === "everyone");
  const expected: LaneDef[] = [];
  const stubMentions: LaneDef[] = [];

  if (everyone) {
    for (const id of room.memberIds) {
      const lane = getLaneByName(lanes, id);
      if (lane?.runtime) expected.push(lane);
    }
    return { expected, stubMentions, everyone: true };
  }

  for (const m of mentions) {
    if (m.kind !== "lane") continue;
    const lane = getLaneByName(lanes, m.laneId);
    if (!lane) continue;
    if (!lane.runtime) {
      stubMentions.push(lane);
      continue;
    }
    expected.push(lane);
  }

  return { expected, stubMentions, everyone: false };
}

function uniqueLanes(lanes: Map<string, LaneDef>): LaneDef[] {
  const seen = new Set<string>();
  const out: LaneDef[] = [];
  for (const lane of lanes.values()) {
    if (seen.has(lane.id)) continue;
    seen.add(lane.id);
    out.push(lane);
  }
  // Longer names first so "Design Lead" wins over "Design".
  out.sort((a, b) => b.name.length - a.name.length);
  return out;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
