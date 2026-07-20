import { IconReset } from "@/icons";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

/**
 * Shared inspector row/section primitives — the ONE row convention every
 * inspector (Attributes panel, material editor, material manager) uses, so
 * heights, label widths and legend spacing stop drifting section by section:
 *
 * - {@link Field} — 96px label + content, fixed `min-h-8` row height so a
 *   select/toggle/input/NumberDrag row all line up. Inputs standardize on the
 *   `-sm` daisyUI size (`input-sm`, `select-sm`, `toggle-sm`).
 * - {@link VecField} — label + 3 NumberDrags with the axis letter INSIDE each
 *   field (the object-Transform style), grid `96px_1fr_1fr_1fr`.
 * - {@link Section} — the fieldset + legend with one padding standard, and an
 *   optional right-aligned reset button in the legend row.
 */

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[96px_1fr] items-center gap-1">
      <span className="truncate opacity-60" title={label}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function VecField({
  label,
  values,
  onChange,
  axes = ["X", "Y", "Z"],
  deg = false,
  step,
  min,
}: {
  label: string;
  values: readonly [number, number, number] | readonly number[];
  /** Per-axis edit — index into `values`, new value in STORED units (rad if `deg`). */
  onChange: (index: number, value: number, committed: boolean) => void;
  /** Axis letters shown inside the fields (e.g. `["H","P","B"]`). */
  axes?: readonly [string, string, string];
  /** Display in degrees, store radians. */
  deg?: boolean;
  step?: number;
  min?: number;
}) {
  const toDisp = deg ? 180 / Math.PI : 1;
  return (
    <div className="grid min-h-8 grid-cols-[96px_1fr_1fr_1fr] items-center gap-1">
      <span className="truncate opacity-60" title={label}>
        {label}
      </span>
      {axes.map((axis, i) => (
        <NumberDrag
          key={axis}
          label={axis}
          step={step ?? (deg ? 0.5 : 0.01)}
          min={min}
          value={(values[i] ?? 0) * toDisp}
          onChange={(v, committed) => onChange(i, v / toDisp, committed)}
        />
      ))}
    </div>
  );
}

export function Section({
  title,
  onReset,
  bordered = true,
  children,
}: {
  title: string;
  /** Renders a right-aligned reset button in the legend row. */
  onReset?: () => void;
  /** `border-b` between stacked sections; off for a panel's last section. */
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset className={`fieldset px-2 pt-2 pb-4 ${bordered ? "border-b border-base-200" : ""}`}>
      <legend className="fieldset-legend flex w-full items-center justify-between py-0 text-[10px] uppercase opacity-60 min-h-6">
        {title}
        {onReset ? (
          <button
            type="button"
            className="btn btn-ghost btn-xs px-1 hover:text-primary"
            onClick={onReset}
            title={`Reset ${title}`}
          >
            <IconReset size={12} />
          </button>
        ) : null}
      </legend>
      {children}
    </fieldset>
  );
}
