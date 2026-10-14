// The top of every fund page: the title, one line on what the page is for or
// how current it is, and the page's own actions on the right. Every page
// uses the same one, so the title is always in the same place at the same
// size, and anything you can do here is always found in the same corner.

import type { ReactNode } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
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
  primary: "bg-accent text-white hover:bg-accent-hover",
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
