import { useState } from "react";
import { IconCaretRight } from "@/icons";

/**
 * Row/Section primitives for the material editor. Split out of
 * `MaterialEditor.tsx` when the noise-map slot arrived — the slot, the inline
 * noise editor and the ramp editor all share them.
 */

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[74px_1fr] items-center gap-1">
      <span className="opacity-60">{label}</span>
      {children}
    </div>
  );
}

export function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-base-300/60 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-base-300/40"
      >
        <IconCaretRight
          size={12}
          className={`opacity-60 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {title}
        </span>
      </button>
      {open ? <div className="flex flex-col gap-1.5 px-2 pb-2">{children}</div> : null}
    </div>
  );
}
