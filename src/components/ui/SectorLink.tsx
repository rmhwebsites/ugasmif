// A sector's name, linked to its page. Sector names appear on holdings,
// pitches, trades, the team page and performance tables; each one is a way
// into that sector, so they all use this rather than plain text.

import Link from "next/link";

export function SectorLink({
  fund,
  slug,
  name,
  className = "",
}: {
  fund: string;
  /** Null when the slug is unknown; the name then renders as plain text. */
  slug: string | null | undefined;
  name: string;
  className?: string;
}) {
  if (!slug) return <span className={className}>{name}</span>;
  return (
    <Link
      href={`/${fund}/sectors/${slug}`}
      className={`hover:text-foreground hover:underline ${className}`}
    >
      {name}
    </Link>
  );
}
