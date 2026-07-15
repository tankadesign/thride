import {
  float,
  Fn,
  hash,
  int,
  mix,
  mx_cell_noise_float,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_noise_vec3,
  mx_worley_noise_float,
  positionLocal,
  triNoise3D,
  vec3,
} from "@/materials/tsl";

/**
 * The TSL noise library (chunk E2). Each noise is a factory returning a TSL
 * node — MaterialX-backed (`mx_*`) or custom — sampled at a 3D coordinate with
 * a common **phase** control for animation. All are re-exported through the
 * `noises` barrel; the layer-stack compiler (E3) and the noise gallery drive
 * them from the registry.
 *
 * Convention: a noise is grayscale (`float`, remapped to ~[0,1] for use as a
 * mask/height) unless documented as vector. `phase` folds into the sample's
 * z-slice, so on a flat surface the 2D pattern **evolves** (boils) as phase
 * animates; in solid 3D it scrolls along z. Curl and triNoise phase differently
 * (documented per-noise).
 */

// TSL nodes are structurally dynamic; the graph layer is intentionally loose.
// biome-ignore lint/suspicious/noExplicitAny: TSL node
type Node = any;
type Num = number | Node;

export interface NoiseOpts {
  /** Sample coordinate (vec3 node). Default `positionLocal`. */
  pos?: Node;
  /** Frequency multiplier. Default 1. */
  scale?: Num;
  /** Animation phase — folded into the sample's z-slice. Default 0. */
  phase?: Num;
}

const F = (n: Num): Node => (typeof n === "number" ? float(n) : n);

/** `pos·scale` with `phase` folded into z so flat surfaces evolve as it animates. */
function samplePos(opts: NoiseOpts): Node {
  const pos = opts.pos ?? positionLocal;
  return pos.mul(F(opts.scale ?? 1)).add(vec3(0, 0, F(opts.phase ?? 0)));
}

/** Perlin gradient noise (MaterialX), remapped to [0,1]. */
export const perlinNoise = (opts: NoiseOpts = {}): Node =>
  mx_noise_float(samplePos(opts)).mul(0.5).add(0.5);

export interface FractalOpts extends NoiseOpts {
  /** Octaves summed (more = finer detail). Default 4. */
  octaves?: number;
  /** Frequency ratio between octaves. Default 2. */
  lacunarity?: number;
  /** Amplitude falloff per octave (0–1). Default 0.5. */
  gain?: number;
}

/** Fractal (fBm) noise (MaterialX) — summed octaves of Perlin, remapped to [0,1]. */
export const fractalNoise = (opts: FractalOpts = {}): Node =>
  mx_fractal_noise_float(samplePos(opts), opts.octaves ?? 4, opts.lacunarity ?? 2, opts.gain ?? 0.5)
    .mul(0.5)
    .add(0.5);

export interface WorleyOpts extends NoiseOpts {
  /** Cell-point jitter: 0 = regular grid, 1 = fully random. Default 1. */
  jitter?: Num;
}

/** Worley (cellular / Voronoi) noise (MaterialX) — distance to the nearest cell point. */
export const worleyNoise = (opts: WorleyOpts = {}): Node =>
  mx_worley_noise_float(samplePos(opts), F(opts.jitter ?? 1));

/** Cell noise (MaterialX) — one constant random value per integer cell (blocky). */
export const cellNoise = (opts: NoiseOpts = {}): Node => mx_cell_noise_float(samplePos(opts));

export interface TriNoiseOpts extends NoiseOpts {
  /** Flow speed of the animated field. Default 0.1. */
  speed?: Num;
}

/**
 * Animated 3D noise (three's `triNoise3D`) — here `phase` is genuine time, so
 * the field boils continuously rather than scrolling. Remapped to [0,1].
 */
export const triNoise = (opts: TriNoiseOpts = {}): Node => {
  const pos = (opts.pos ?? positionLocal).mul(F(opts.scale ?? 1));
  return triNoise3D(pos, F(opts.speed ?? 0.1), F(opts.phase ?? 0));
};

/**
 * Lattice-corner seeds for {@link valueNoise3} (Teschner spatial hash: per-axis
 * large-prime multiply, xor-combined).
 *
 * Why this and not a float dot product: `hash()` opens with `seed.toUint()`. In
 * WGSL a **float**→u32 conversion clamps a negative value to 0, so a float seed
 * makes every cell in the negative octant hash identically — a flat blob. An
 * **int**→u32 conversion is a bit reinterpretation instead, so staying in int
 * space the whole way keeps negative lattice coords hashing correctly.
 *
 * The remaining limit is f32 precision in the *coordinate*, not the hash: past
 * ~100k the mantissa has too few bits left for the fractional part and the
 * lattice blurs out (measured: fine at ±9k, degenerate at 500k). That bound is
 * inherent to sampling a float position and applies to every noise here, not
 * just this one.
 */
const PRIMES: [number, number, number] = [73856093, 19349663, 83492791];

/**
 * Custom 3D value noise — hash-lattice with a smoothstep-interpolated trilinear
 * blend. Distinct from Perlin (value vs gradient): blockier, cheaper. [0,1].
 */
const valueNoise3 = /*@__PURE__*/ Fn(([p]: [Node]): Node => {
  const i = p.floor();
  const f = p.fract();
  const u = f.mul(f).mul(f.mul(-2).add(3)); // 3f²−2f³ smoothstep
  const h = (ox: number, oy: number, oz: number): Node => {
    const c = i.add(vec3(ox, oy, oz));
    return hash(
      c.x
        .toInt()
        .mul(int(PRIMES[0]))
        .bitXor(c.y.toInt().mul(int(PRIMES[1])))
        .bitXor(c.z.toInt().mul(int(PRIMES[2]))),
    );
  };
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), u.x), mix(h(0, 1, 0), h(1, 1, 0), u.x), u.y),
    mix(mix(h(0, 0, 1), h(1, 0, 1), u.x), mix(h(0, 1, 1), h(1, 1, 1), u.x), u.y),
    u.z,
  );
});

/** Custom value noise (see {@link valueNoise3}). */
export const valueNoise = (opts: NoiseOpts = {}): Node => valueNoise3(samplePos(opts));

/**
 * Custom curl noise — divergence-free 3D flow field (returns **vec3**). The curl
 * of a `mx_noise_vec3` vector potential via central differences; useful for
 * swirling advection. `phase` folds into z like the spatial noises.
 */
const EPS = 0.01;
const curlNoise3 = /*@__PURE__*/ Fn(([p]: [Node]): Node => {
  const e = float(EPS);
  const pot = (q: Node): Node => mx_noise_vec3(q);
  const px0 = pot(p.sub(vec3(EPS, 0, 0)));
  const px1 = pot(p.add(vec3(EPS, 0, 0)));
  const py0 = pot(p.sub(vec3(0, EPS, 0)));
  const py1 = pot(p.add(vec3(0, EPS, 0)));
  const pz0 = pot(p.sub(vec3(0, 0, EPS)));
  const pz1 = pot(p.add(vec3(0, 0, EPS)));
  return vec3(
    py1.z.sub(py0.z).sub(pz1.y.sub(pz0.y)),
    pz1.x.sub(pz0.x).sub(px1.z.sub(px0.z)),
    px1.y.sub(px0.y).sub(py1.x.sub(py0.x)),
  ).div(e.mul(2));
});

/** Custom curl-noise flow field, vec3 (see {@link curlNoise3}). */
export const curlNoise = (opts: NoiseOpts = {}): Node => curlNoise3(samplePos(opts));
