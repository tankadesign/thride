import { useEffect, useRef, useState } from "react";
import { defaultNoiseParams, NOISE_DEFS } from "@/materials/noises";
import { NoiseThumbnails } from "@/render/thumbnails/noiseThumbnails";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

/**
 * Noise gallery (View → Noise Gallery) — the E2 TSL noise library rendered
 * live. Each catalog noise is shaded onto an offscreen quad at its default
 * params; the phase slider re-renders all so the animated types (Tri) visibly
 * boil. This is the visual golden for the noise library: correct WebGPU compile
 * + expected pattern per noise.
 */
export function NoiseGalleryPanel() {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState(0);
  const thumbsRef = useRef<NoiseThumbnails | null>(null);

  useEffect(() => {
    const thumbs = new NoiseThumbnails(160);
    thumbsRef.current = thumbs;
    return () => {
      thumbs.dispose();
      thumbsRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const thumbs = thumbsRef.current;
    if (!thumbs) return;
    void (async () => {
      for (const def of NOISE_DEFS) {
        const url = await thumbs.render(def, defaultNoiseParams(def), phase);
        if (cancelled) return;
        setUrls((u) => ({ ...u, [def.id]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-base-100 p-3 text-xs">
      <div className="grid grid-cols-[56px_1fr] items-center gap-1">
        <span className="opacity-60">Phase</span>
        <NumberDrag value={phase} step={0.05} min={0} max={100} onChange={(v) => setPhase(v)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {NOISE_DEFS.map((def) => (
          <div key={def.id} className="flex flex-col gap-1">
            {/* an empty src makes React (rightly) warn about a page re-download */}
            {urls[def.id] ? (
              <img
                src={urls[def.id]}
                alt={def.label}
                className="aspect-square w-full rounded border border-base-300 bg-base-200 object-cover"
              />
            ) : (
              <div className="aspect-square w-full rounded border border-base-300 bg-base-200" />
            )}
            <div className="flex items-center justify-between">
              <span className="font-medium">{def.label}</span>
              <span className="badge badge-xs opacity-60">{def.category}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
