import { describe, expect, it } from "vite-plus/test";
import { isUuid, uuidv7 } from "./uuid";

describe("uuidv7", () => {
  it("produces canonical, valid v7 UUIDs", () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("7"); // version nibble
    expect(["8", "9", "a", "b"]).toContain(id[19]); // RFC variant
  });

  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7()));
    expect(ids.size).toBe(5000);
  });

  it("sorts by timestamp", () => {
    const early = uuidv7(1_000_000_000_000);
    const late = uuidv7(2_000_000_000_000);
    expect(early < late).toBe(true);
  });

  it("encodes the full 48-bit timestamp big-endian", () => {
    const id = uuidv7(0x0123_4567_89ab);
    expect(id.startsWith("01234567-89ab")).toBe(true);
  });
});
