// The top of every fund page: the title, one line on what the page is for or
// how current it is, and the page's own actions on the right. Every page
// uses the same one, so the title is always in the same place at the same
// size, and anything you can do here is always found in the same corner.
//
// Detail pages pass `back` (the list they belong to), which sits above the
// title in one style everywhere: "← Pitches", "← Sectors", "← Members".

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Settings2 } from "lucide-react";

export interface BackTo {
  href: string;
  /** The parent page's name as the sidebar or tab shows it, e.g. "Pitches". */
  label: string;
}

/** "← Pitches": the way up from a detail page to its list. */
export function BackLink({ href, label }: BackTo) {
  return (
    <Link
      href={href}
      className="-ml-1 -my-2 inline-flex items-center gap-1 rounded-md px-1 py-2.5 text-sm text-muted transition-colors hover:text-foreground sm:my-0 sm:py-0.5"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </Link>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: BackTo;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {back && (
          <div className="mb-1">
            <BackLink {...back} />
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

const LINK_BUTTON = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-highlight text-foreground hover:bg-card-border",
} as const;

/** A link that looks like a button: the page's main action, or a quiet one. */
export function LinkButton({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof LINK_BUTTON;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${LINK_BUTTON[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

/**
 * The way from a page to where it is edited, for the people who edit it.
 * Viewing and managing live in different places (the page and Fund admin);
 * this keeps the two a click apart.
 */
export function ManageLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <LinkButton href={href} variant="secondary">
      <Settings2 className="h-4 w-4" />
      {children}
    </LinkButton>
  );
}

/**
 * The way from an admin page back to the page members see, e.g. "View
 * holdings" on Manage holdings. The mirror of ManageLink.
 */
export function ViewLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <LinkButton href={href} variant="secondary">
      <Eye className="h-4 w-4" />
      {children}
    </LinkButton>
  );
}
