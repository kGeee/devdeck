import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, before, after } from "node:test";
import { loadPacks, getLaneByName, runtimeLanes } from "../pack-loader";
import {
  openShippingRoom,
  postToRoom,
  routeTargets,
  openRoom,
} from "../rooms";
import { loadSkills, matchSkills } from "../skills";
import {
  saveRoutine,
  handleRoutineWake,
  validateRoutine,
  validateRoutineFromPacks,
  loadRoutineSchema,
  loadRoutine,
} from "../routines";
import { writeProfile, writeProjectShard, loadMemory } from "../memory";
import {
  createRunLock,
  receiveInbound,
  endTurn,
  createApprovalGate,
  requestApproval,
  resolveApproval,
} from "../concurrency";
import { gateDispatch, assertDesignLock, canStartExecutor } from "../dispatch";
import { createCodeJob, createPlan, lockPlan } from "../codejob";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function fixtureRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devdeck-os-"));
  await cp(path.join(REPO, "packs"), path.join(dir, "packs"), { recursive: true });
  await mkdir(path.join(dir, ".devdeck", "os"), { recursive: true });
  return dir;
}

describe("pack load + lane registry", () => {
  let cwd: string;
  before(async () => {
    cwd = await fixtureRoot();
  });
  after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("loads manifest loadOrder and registers runtime vs stub lanes", async () => {
    const packs = await loadPacks(cwd);
    assert.equal(packs.manifest.packVersion, 1);
    assert.equal(packs.files.length, packs.manifest.loadOrder.length);
    assert.equal(packs.files[0].path, "concurrency.md");

    const coord = getLaneByName(packs.lanes, "Coordinator");
    assert.ok(coord);
    assert.equal(coord.runtime, true);

    const design = getLaneByName(packs.lanes, "Design Lead");
    assert.ok(design);
    assert.equal(design.runtime, false);

    const runtime = runtimeLanes(packs.lanes);
    assert.deepEqual(
      runtime.map((l) => l.id).sort(),
      ["coordinator", "executor", "merger", "planner", "reviewer"]
    );
  });
});

describe("room membership + @routing", () => {
  let cwd: string;
  before(async () => {
    cwd = await fixtureRoot();
  });
  after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("seeds DevDeck shipping room, drops non-members, routes @Name and @everyone", async () => {
    const packs = await loadPacks(cwd);
    const room = await openShippingRoom(cwd);
    assert.equal(room.name, "DevDeck");
    assert.ok(room.memberIds.includes("coordinator"));

    const dropped = await postToRoom(room.id, "stranger", "hello", cwd);
    assert.equal(dropped.ok, false);

    const ok = await postToRoom(room.id, "coordinator", "spec locked", cwd);
    assert.equal(ok.ok, true);

    await openRoom(
      { id: room.id, name: room.name, memberIds: ["coordinator", "planner", "executor"] },
      cwd
    );
    const members = await openShippingRoom(cwd);

    const routed = routeTargets("@Planner please plan", members, packs.lanes);
    assert.equal(routed.expected.map((l) => l.id).join(), "planner");
    assert.equal(routed.everyone, false);

    const stubs = routeTargets("@Design Lead lock this", members, packs.lanes);
    assert.equal(stubs.expected.length, 0);
    assert.equal(stubs.stubMentions[0]?.id, "design-lead");

    const all = routeTargets("@everyone status", members, packs.lanes);
    assert.equal(all.everyone, true);
    assert.ok(all.expected.some((l) => l.id === "coordinator"));
    assert.ok(all.expected.some((l) => l.id === "planner"));
  });
});

describe("skill load", () => {
  let cwd: string;
  before(async () => {
    cwd = await fixtureRoot();
  });
  after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("loads SKILL.md frontmatter and matches by description", async () => {
    const skills = await loadSkills(cwd);
    assert.equal(skills.length, 3);
    assert.ok(skills.some((s) => s.name === "Design lock"));
    assert.ok(skills.some((s) => s.name === "Ledger recall"));
    assert.ok(skills.some((s) => s.name === "PR verdict"));

    const matched = matchSkills(
      skills,
      "Need a complete Design lock before Planner for this UI surface"
    );
    assert.ok(matched.some((s) => s.slug === "design-lock"));
  });
});

describe("routine save + self-delete", () => {
  let cwd: string;
  before(async () => {
    cwd = await fixtureRoot();
  });
  after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("validates via _schema.json, rejects schema failures, saves, and self-deletes", async () => {
    const schema = await loadRoutineSchema(cwd);
    assert.equal(schema.$id, "devdeck.routine.v1");
    assert.ok(Array.isArray(schema.required));

    assert.equal(
      validateRoutine(
        {
          name: "x",
          prompt: "y",
          enabled: true,
          trigger: { type: "cron", schedule: "0 9 * * 1-5" },
        },
        schema
      ).ok,
      true
    );

    const missingSchedule = validateRoutine(
      { name: "x", prompt: "y", enabled: true, trigger: { type: "cron" } },
      schema
    );
    assert.equal(missingSchedule.ok, false);

    const missingRequired = await validateRoutineFromPacks(
      { prompt: "y", enabled: true, trigger: { type: "cron", schedule: "0 9 * * 1-5" } },
      cwd
    );
    assert.equal(missingRequired.ok, false);
    if (!missingRequired.ok) {
      assert.ok(missingRequired.errors.some((e) => e.includes("name")));
    }

    const wildcardRepo = validateRoutine(
      {
        name: "x",
        prompt: "y",
        enabled: true,
        trigger: { type: "github", repo: "org/*", events: ["pr-merged"] },
      },
      schema
    );
    assert.equal(wildcardRepo.ok, false);
    if (!wildcardRepo.ok) {
      assert.ok(wildcardRepo.errors.some((e) => e.includes("wildcard")));
    }

    await assert.rejects(
      () =>
        saveRoutine(
          {
            name: "bad",
            prompt: "no trigger shape",
            enabled: true,
            // @ts-expect-error intentional schema failure
            trigger: { type: "cron" },
          },
          cwd
        ),
      /invalid routine/
    );

    const r = await saveRoutine(
      {
        name: "watch pr",
        prompt: "Ping when merged",
        enabled: true,
        trigger: {
          type: "github",
          repo: "kGeee/devdeck",
          events: ["pr-merged"],
          pr: 1,
        },
      },
      cwd
    );
    assert.ok(r.id);
    assert.ok(await loadRoutine(r.id, cwd));

    const wake = await handleRoutineWake(r, { event: "pr-merged" }, cwd);
    assert.equal(wake.deleted, true);
    assert.equal(await loadRoutine(r.id, cwd), null);

    const finite = await saveRoutine(
      {
        name: "temp",
        prompt: "expire me",
        enabled: true,
        trigger: { type: "cron", schedule: "0 10 * * 1-5" },
        expiresAt: "2000-01-01T00:00:00.000Z",
      },
      cwd
    );
    const expired = await handleRoutineWake(finite, { now: new Date() }, cwd);
    assert.equal(expired.deleted, true);
  });
});

describe("memory shard-writer refuse", () => {
  let cwd: string;
  before(async () => {
    cwd = await fixtureRoot();
  });
  after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("refuses write when callerId !== ownerAgentId; precedence project > log > profile", async () => {
    const ok = await writeProfile("coordinator", "coordinator", "op=kevin\n", cwd);
    assert.equal(ok.ok, true);

    const refused = await writeProfile("coordinator", "planner", "hack\n", cwd);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.reason, "refused");

    const proj = await writeProjectShard(
      "devdeck",
      "coordinator",
      "coordinator",
      "ship kernel\n",
      cwd
    );
    assert.equal(proj.ok, true);

    const mem = await loadMemory("coordinator", { projectSlug: "devdeck", cwd });
    assert.ok(mem.resolved.startsWith("# project"));
    assert.ok(mem.resolved.includes("# profile"));
  });
});

describe("Executor refuse without locked plan", () => {
  it("rejects missing or unlocked plan; accepts locked", () => {
    const unlocked = createPlan({
      id: "p1",
      goal: "x",
      constraints: [],
      steps: [],
      outOfScope: [],
      doneWhen: [],
      ledgerRefs: [],
      locked: false,
    });
    assert.equal(canStartExecutor(unlocked).ok, false);
    assert.equal(canStartExecutor(null).ok, false);

    const jobBad = createCodeJob({
      repo: "kGeee/devdeck",
      branch: "feat",
      plan: unlocked,
    });
    assert.equal(jobBad.ok, false);

    const locked = lockPlan(unlocked);
    assert.equal(canStartExecutor(locked).ok, true);
    const job = createCodeJob({
      repo: "kGeee/devdeck",
      branch: "feat",
      plan: locked,
    });
    assert.equal(job.ok, true);
  });
});

describe("Design-lock reject on missing item", () => {
  it("rejects incomplete lock; code-only skips; full lock passes", () => {
    const missing = assertDesignLock({
      layout: "a",
      type: "b",
      color: "c",
      density: "d",
      states: "e",
      // empty/error missing
      keyboard: "g",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.ok(missing.missing?.includes("empty/error"));

    const ui = gateDispatch({
      kind: "ui",
      targetLane: "planner",
      designLock: { layout: "a" },
    });
    assert.equal(ui.ok, false);

    const codeOnly = gateDispatch({ kind: "code-only", targetLane: "planner" });
    assert.equal(codeOnly.ok, true);

    const full: Record<string, string> = {
      layout: "a",
      type: "b",
      color: "c",
      density: "d",
      states: "e",
      "empty/error": "f",
      keyboard: "g",
    };
    assert.equal(assertDesignLock(full).ok, true);
  });
});

describe("run-lock queue vs steer", () => {
  it("does not start a second turn; queues new asks and steers corrections", () => {
    let lock = createRunLock("chat-1");
    const first = receiveInbound(lock, "build the kernel");
    assert.equal(first.started, true);
    if (!first.started) throw new Error("expected start");
    lock = first.lock;

    const queued = receiveInbound(lock, "also add a dashboard");
    assert.equal(queued.started, false);
    if (queued.started) throw new Error("no second turn");
    assert.equal(queued.inbound.mode, "queue");
    lock = queued.lock;

    const steered = receiveInbound(lock, "stop — actually skip the dashboard");
    assert.equal(steered.started, false);
    if (steered.started) throw new Error("no second turn");
    assert.equal(steered.inbound.mode, "steer");
    lock = steered.lock;

    assert.equal(lock.status, "active");
    assert.equal(lock.inbound.length, 2);

    const ended = endTurn(lock);
    assert.equal(ended.lock.status, "idle");
    assert.equal(ended.nextQueued?.mode, "queue");
    assert.equal(ended.steered.length, 1);
  });
});

describe("approval-gate pause until allow/deny", () => {
  it("pauses on card, blocks a second card, allow resumes, deny ends action", () => {
    let gate = createApprovalGate("stream-1");
    const req = requestApproval(gate, "Merge PR?");
    assert.equal(req.ok, true);
    if (!req.ok) throw new Error("expected card");
    gate = req.gate;
    assert.equal(gate.streamStatus, "paused");
    assert.ok(gate.card);

    const blocked = requestApproval(gate, "Another?");
    assert.equal(blocked.ok, false);

    const allowed = resolveApproval(gate, "allow");
    assert.equal(allowed.endedAction, false);
    assert.equal(allowed.gate.streamStatus, "running");
    assert.equal(allowed.gate.card, null);

    gate = createApprovalGate("stream-2");
    const req2 = requestApproval(gate, "Delete?");
    assert.ok(req2.ok);
    if (!req2.ok) throw new Error("expected card");
    const denied = resolveApproval(req2.gate, "deny");
    assert.equal(denied.endedAction, true);
    assert.equal(denied.gate.card, null);
    assert.equal(denied.gate.streamStatus, "running");
  });
});
