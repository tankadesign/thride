/**
 * Row/Section primitives for the material editor. Split out of
 * `MaterialEditor.tsx` when the noise-map slot arrived — the slot, the inline
 * noise editor and the ramp editor all share them.
 */

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-1">
      <span className="opacity-60">{label}</span>
      {children}
    </div>
  );
}
