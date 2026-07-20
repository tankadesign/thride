import { useState } from "react";
import { IconCaretRight } from "@/icons";
export function CollapsingSection({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
  classNames = "",
  openClassNames = "",
}: {
  title: string;
  defaultOpen?: boolean;
  /** Controlled open state — when set, the caller owns it (e.g. persisted UI). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  classNames?: string;
  openClassNames?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp ?? internalOpen;
  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return (
    <div
      className={`border-t border-base-300/60 first:border-t-0 transition-all duration-300 ease-in-out ${classNames} ${open ? openClassNames || "pt-2 pb-4 glow-down" : ""}`}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:text-primary transition-colors duration-300 ease-out"
      >
        <IconCaretRight
          size={12}
          className={`opacity-60 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {title}
        </span>
      </button>
      {open ? <div className={`flex flex-col gap-1.5 px-4 pb-2`}>{children}</div> : null}
    </div>
  );
}
