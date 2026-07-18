export function ColorPicker({ color, ...others }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span
      className="block w-10 h-10 rounded-full outline outline-base-content/20 outline-offset-1 has-[input:focus]:outline-primary"
      style={{ backgroundColor: color }}
    >
      <input
        type="color"
        className="h-full w-full m-0 border-none cursor-pointer opacity-0 p-0"
        value={color}
        {...others}
      />
    </span>
  );
}
