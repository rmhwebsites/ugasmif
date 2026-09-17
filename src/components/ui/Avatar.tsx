// A member's picture: their upload when they have one, otherwise the default
// grey silhouette. Everyone shares the same placeholder on purpose — it reads
// as "no photo yet" rather than as a thing someone chose.
//
// Decorative by design: every place this is used prints the name next to it,
// so alt text would just be read twice.

const SIZES = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-16 w-16",
  xl: "h-20 w-20",
} as const;

export function Avatar({
  src,
  size = "md",
  className = "",
}: {
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const box = `${SIZES[size]} shrink-0 overflow-hidden rounded-full bg-highlight ${className}`;

  if (!src || src.trim() === "") {
    return (
      <span className={box}>
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="h-full w-full text-muted/55"
        >
          <circle cx="12" cy="9" r="4" />
          {/* Runs past the bottom edge so the shoulders are cut by the circle
              rather than floating inside it. */}
          <path d="M12 14.4c-4.5 0-8.2 3-8.2 6.7V24h16.4v-2.9c0-3.7-3.7-6.7-8.2-6.7z" />
        </svg>
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src.trim()}
      alt=""
      loading="lazy"
      decoding="async"
      className={`${box} object-cover`}
    />
  );
}
