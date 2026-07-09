import { describe, expect, it, vi } from "vite-plus/test";
import { EventBus } from "./EventBus";

interface TestMap extends Record<string, unknown> {
  ping: { n: number };
}

describe("EventBus", () => {
  it("delivers payloads to subscribers and honors unsubscribe", () => {
    const bus = new EventBus<TestMap>();
    const seen: number[] = [];
    const off = bus.on("ping", (p) => seen.push(p.n));
    bus.emit("ping", { n: 1 });
    off();
    bus.emit("ping", { n: 2 });
    expect(seen).toEqual([1]);
  });

  it("isolates throwing listeners", () => {
    const bus = new EventBus<TestMap>();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: number[] = [];
    bus.on("ping", () => {
      throw new Error("bad panel");
    });
    bus.on("ping", (p) => seen.push(p.n));
    bus.emit("ping", { n: 7 });
    expect(seen).toEqual([7]);
    expect(errSpy).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });
});
