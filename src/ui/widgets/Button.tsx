import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost";
  active?: boolean;
}

export function Button({ variant = "default", active, ...rest }: ButtonProps) {
  return (
    <button type="button" className="t-btn" data-variant={variant} data-active={active} {...rest} />
  );
}
