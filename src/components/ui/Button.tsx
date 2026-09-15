"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:hover:bg-accent",
  secondary:
    "border border-input-border bg-input-bg hover:bg-highlight disabled:opacity-50",
  danger:
    "bg-loss text-white hover:bg-loss/85 disabled:opacity-50 disabled:hover:bg-loss",
  ghost: "text-muted hover:bg-highlight hover:text-foreground",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
