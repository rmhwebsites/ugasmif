import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`glass-card ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  action,
  className = "",
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  // A link in the action slot ("All holdings") gets a 40px tall tap area on
  // phones. The padding is cancelled by a negative margin, so the header
  // keeps its height.
  return (
    <div
      className={`flex items-center justify-between border-b border-card-border px-4 py-3 sm:px-6 sm:py-4 [&>a]:-my-2.5 [&>a]:py-2.5 sm:[&>a]:my-0 sm:[&>a]:py-0 ${className}`}
    >
      <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
      {action}
    </div>
  );
}

/**
 * A headline figure. With `href` the whole tile opens the page that explains
 * the figure (YTD return → Performance), and a chevron beside the label says
 * so; without it the tile is plain.
 */
export function StatCard({
  label,
  value,
  sub,
  subClassName = "",
  href,
  linkTitle,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  subClassName?: string;
  href?: string;
  /** Tooltip naming where the tile goes, e.g. "Open Performance". */
  linkTitle?: string;
}) {
  const body = (
    <>
      <p className="flex items-center gap-0.5 text-sm text-muted">
        {label}
        {href && (
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 transition-colors group-hover:text-accent-text"
            aria-hidden="true"
          />
        )}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
        {value}
      </p>
      {sub !== undefined && (
        <p className={`mt-0.5 text-xs tabular-nums sm:text-sm ${subClassName}`}>
          {sub}
        </p>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        title={linkTitle}
        className="glass-card group block p-4 transition-colors hover:bg-highlight sm:p-5"
      >
        {body}
      </Link>
    );
  }
  return <div className="glass-card p-4 sm:p-5">{body}</div>;
}
