/** Dense bitset over element indices (verts/edges/faces of one mesh). */
export class Bitset {
  private words: Uint32Array;

  constructor(capacity = 0) {
    this.words = new Uint32Array(Math.ceil(capacity / 32));
  }

  has(i: number): boolean {
    const w = this.words[i >> 5];
    return w !== undefined && (w & (1 << (i & 31))) !== 0;
  }

  add(i: number): void {
    const w = i >> 5;
    if (w >= this.words.length) {
      const grown = new Uint32Array(Math.max(w + 1, this.words.length * 2));
      grown.set(this.words);
      this.words = grown;
    }
    this.words[w]! |= 1 << (i & 31);
  }

  delete(i: number): void {
    const w = i >> 5;
    if (w < this.words.length) this.words[w]! &= ~(1 << (i & 31));
  }

  clear(): void {
    this.words.fill(0);
  }

  get count(): number {
    let n = 0;
    for (let w = 0; w < this.words.length; w++) {
      let v = this.words[w]!;
      while (v) {
        v &= v - 1;
        n++;
      }
    }
    return n;
  }

  forEach(fn: (i: number) => void): void {
    for (let w = 0; w < this.words.length; w++) {
      let v = this.words[w]!;
      while (v) {
        const bit = 31 - Math.clz32(v & -v);
        fn((w << 5) + bit);
        v &= v - 1;
      }
    }
  }

  toArray(): number[] {
    const out: number[] = [];
    this.forEach((i) => out.push(i));
    return out;
  }

  clone(): Bitset {
    const b = new Bitset();
    b.words = this.words.slice();
    return b;
  }
}
