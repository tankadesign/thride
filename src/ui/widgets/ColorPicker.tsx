export function ColorPicker({
  color,
  size,
  ...others
}: React.InputHTMLAttributes<HTMLInputElement> & { size?: string }) {
  return (
    <span
      className={`block ${size ?? "size-8"} mt-1 rounded-full outline outline-base-content/20 outline-offset-1 has-[input:focus]:outline-primary"`}
      style={{ backgroundColor: color }}
    >
      <input
        type="color"
        className="h-full w-full m-0 shrink-0 aspect-square border-none cursor-pointer opacity-0 p-0"
        value={color}
        {...others}
      />
    </span>
  );
}
