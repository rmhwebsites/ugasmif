// A member's picture. Their upload when they have one, otherwise a generated
// stand-in from /api/avatar/[seed] so a roster grid is never a wall of empty
// circles. Initials are the last resort, for a row with no id to seed from.
//
// Decorative by design: every place this is used prints the name next to it,
// so alt text would just be read twice.

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-base",
  xl: "h-20 w-20 text-lg",
} as const;

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  src,
  seed,
  name,
  size = "md",
  className = "",
}: {
  src?: string | null;
  seed?: string | null;
  name?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const box = `${SIZES[size]} shrink-0 rounded-full bg-highlight ${className}`;
  const url =
    src && src.trim() !== ""
      ? src.trim()
      : seed && seed.trim() !== ""
        ? `/api/avatar/${encodeURIComponent(seed.trim())}`
        : null;

  if (url === null) {
    return (
      <span
        aria-hidden="true"
        className={`${box} flex items-center justify-center font-semibold text-muted`}
      >
        {initialsOf(name)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      className={`${box} object-cover`}
    />
  );
}
