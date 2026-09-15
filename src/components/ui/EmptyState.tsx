import type { ReactNode } from "react";

/** Empty states always tell the user what to do next (spec 11.4). */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass-card p-8 text-center sm:p-12">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{hint}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
