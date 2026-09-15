import type { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "gain"
  | "loss"
  | "warn"
  | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-highlight text-muted",
  accent: "bg-accent-soft text-accent",
  gain: "bg-gain/15 text-gain",
  loss: "bg-loss/15 text-loss",
  warn: "bg-yellow-500/15 text-yellow-500",
  info: "bg-sky-500/15 text-sky-400",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Status badge for the pitch lifecycle. */
export function PitchStatusBadge({ status }: { status: string }) {
  const tone: BadgeTone =
    status === "passed" || status === "executed"
      ? "gain"
      : status === "failed"
      ? "loss"
      : status === "voting"
      ? "accent"
      : status === "scheduled" || status === "submitted"
      ? "info"
      : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}
