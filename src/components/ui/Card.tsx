import type { ReactNode } from "react";

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
  return (
    <div
      className={`flex items-center justify-between border-b border-card-border px-4 py-3 sm:px-6 sm:py-4 ${className}`}
    >
      <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  subClassName = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  subClassName?: string;
}) {
  return (
    <div className="glass-card p-4 sm:p-5">
      <p className="text-[11px] uppercase tracking-wider text-muted sm:text-xs">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
        {value}
      </p>
      {sub !== undefined && (
        <p className={`mt-0.5 text-xs tabular-nums sm:text-sm ${subClassName}`}>
          {sub}
        </p>
      )}
    </div>
  );
}
