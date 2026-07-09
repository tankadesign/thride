import type { Uuid } from "@/types/core";

const HEX = "0123456789abcdef";

/**
 * UUIDv7: 48-bit unix-ms timestamp + random. Time-ordered so ids sort by
 * creation time — useful for stable file member names and debugging.
 * (crypto.randomUUID() is v4, hence this implementation.)
 */
export function uuidv7(now: number = Date.now()): Uuid {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);

  // 48-bit big-endian timestamp in bytes 0-5
  b[0] = (now / 2 ** 40) & 0xff;
  b[1] = (now / 2 ** 32) & 0xff;
  b[2] = (now / 2 ** 24) & 0xff;
  b[3] = (now / 2 ** 16) & 0xff;
  b[4] = (now / 2 ** 8) & 0xff;
  b[5] = now & 0xff;
  // version 7 in the high nibble of byte 6, RFC variant in byte 8
  b[6] = 0x70 | (b[6]! & 0x0f);
  b[8] = 0x80 | (b[8]! & 0x3f);

  let s = "";
  for (let i = 0; i < 16; i++) {
    const byte = b[i]!;
    s += HEX[byte >> 4]! + HEX[byte & 0x0f]!;
    if (i === 3 || i === 5 || i === 7 || i === 9) s += "-";
  }
  return s as Uuid;
}

export function isUuid(value: string): value is Uuid {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
