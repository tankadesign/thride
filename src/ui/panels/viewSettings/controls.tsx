/**
 * Shared row/toggle/select/section primitives for the View Settings modal.
 * Split out of `ViewSettingsModal.tsx` when C6 added the Post Processing tab —
 * the modal was already at the 500-line limit, and the tabs need the same
 * widgets.
 */

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-1">
      <span className="opacity-60">{label}</span>
      {children}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label}>
      <input
        type="checkbox"
        className="toggle toggle-sm"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </Row>
  );
}

export function Select({
  value,
  options,
  disabled = false,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="select select-md w-full"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
