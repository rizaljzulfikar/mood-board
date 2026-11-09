import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { instances, sent } = vi.hoisted(() => ({
  instances: [] as FakeWebSocket[],
  sent: [] as string[],
}));

class FakeWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;

  constructor(public readonly url: string) {
    super();
    instances.push(this);
  }

  send(payload: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("socket not open");
    sent.push(payload);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }
}

vi.mock("ws", () => ({ default: FakeWebSocket }));

beforeEach(() => {
  instances.length = 0;
  sent.length = 0;
  vi.resetModules();
});

describe("default publish transport", () => {
  it("holds frames until the socket opens, then flushes them in order", async () => {
    const mod = await import("@/lib/realtime-publish");
    mod.broadcastUpsert("p1", "item", { id: "first" });
    mod.broadcastDelete("p1", "group", "second");

    expect(instances).toHaveLength(1);
    expect(sent).toHaveLength(0);

    instances[0].open();

    expect(sent.map((frame) => JSON.parse(frame).event.type)).toEqual([
      "item:upsert",
      "group:delete",
    ]);
  });

  it("sends immediately once the socket is open", async () => {
    const mod = await import("@/lib/realtime-publish");
    mod.broadcastUpsert("p1", "item", { id: "warm-up" });
    instances[0].open();
    sent.length = 0;

    mod.broadcastUpsert("p1", "item", { id: "warm" });

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]).event.data.id).toBe("warm");
  });

  it("broadcastMembers frames the member list and removed ids", async () => {
    const mod = await import("@/lib/realtime-publish");
    const members = [{ id: "u2", email: "b@test.local", name: "B" }];
    mod.broadcastMembers("p1", members, ["u1"]);
    instances[0].open();

    expect(sent).toHaveLength(1);
    const frame = JSON.parse(sent[0]);
    expect(frame.projectId).toBe("p1");
    expect(frame.event).toEqual({
      type: "project:members",
      members,
      removedUserIds: ["u1"],
    });
  });
});
