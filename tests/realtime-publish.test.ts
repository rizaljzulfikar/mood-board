import { describe, it, expect, afterEach } from "vitest";
import { broadcastUpsert, broadcastDelete, buildPublishMessage, setPublishTransportForTest } from "@/lib/realtime-publish";

const sent: unknown[] = [];
setPublishTransportForTest((m) => sent.push(m));
afterEach(() => { sent.length = 0; });

describe("buildPublishMessage", () => {
  it("builds an upsert event", () => {
    expect(buildPublishMessage("p1", "item", "upsert", { id: "i1" }))
      .toEqual({ type: "publish", projectId: "p1", event: { type: "item:upsert", data: { id: "i1" } } });
  });
  it("builds a delete event", () => {
    expect(buildPublishMessage("p1", "group", "delete", "g1"))
      .toEqual({ type: "publish", projectId: "p1", event: { type: "group:delete", id: "g1" } });
  });
});

describe("broadcast helpers", () => {
  it("forwards to the transport", () => {
    broadcastUpsert("p1", "connection", { id: "c1" });
    broadcastDelete("p1", "item", "i1");
    expect(sent).toHaveLength(2);
  });
  it("never throws when the transport throws", () => {
    setPublishTransportForTest(() => { throw new Error("hub down"); });
    expect(() => broadcastUpsert("p1", "item", { id: "i1" })).not.toThrow();
    setPublishTransportForTest((m) => sent.push(m));
  });
});
