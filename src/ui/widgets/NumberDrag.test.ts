import { describe, expect, it } from "vite-plus/test";
import { format } from "./NumberDrag";

describe("NumberDrag format", () => {
  it("keeps integer trailing zeros (the 400 → 4 bug)", () => {
    expect(format(400, 0)).toBe("400");
    expect(format(4000, 0)).toBe("4000");
    expect(format(100, 0)).toBe("100");
    expect(format(0, 0)).toBe("0");
  });

  it("strips only fractional trailing zeros", () => {
    expect(format(4.5, 3)).toBe("4.5");
    expect(format(4.05, 3)).toBe("4.05");
    expect(format(4, 3)).toBe("4");
    expect(format(100, 3)).toBe("100");
    expect(format(4500, 3)).toBe("4500"); // integer zeros survive at any precision
    expect(format(0, 3)).toBe("0");
  });

  it("handles negatives", () => {
    expect(format(-400, 0)).toBe("-400");
    expect(format(-4.5, 3)).toBe("-4.5");
  });
});
