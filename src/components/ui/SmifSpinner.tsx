// Loading indicator built from the SMIF mark. The logo is a bull and a bear
// circling each other, so a slow rotation is the natural motion — it reads as
// the pair turning rather than as a generic spinner.
//
// Respects prefers-reduced-motion: the rotation stops and a gentle opacity
// pulse carries the "working" signal instead.

import { SmifLogo } from "@/components/icons/SmifLogo";

const SIZES = {
  sm: "h-5 w-5",
  md: "h-10 w-10",
  lg: "h-16 w-16",
} as const;

export function SmifSpinner({
  size = "md",
  className = "",
  label = "Loading",
}: {
  size?: keyof typeof SIZES;
  className?: string;
  /** Announced to screen readers; pass null to hide when a parent labels it. */
  label?: string | null;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center justify-center ${className}`}
    >
      <SmifLogo className={`smif-spin ${SIZES[size]}`} />
      {label !== null && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Centered full-panel loading state for a page or card body. */
export function SmifLoading({
  message = "Loading",
  className = "",
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-16 ${className}`}
    >
      <SmifSpinner size="lg" label={null} />
      <p role="status" aria-live="polite" className="text-sm text-muted">
        {message}
      </p>
    </div>
  );
}
