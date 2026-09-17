"use client";

// A row of people you swipe through: picture, name, role under the name.
// Used wherever the app lists a team, so the roster and a sector page show
// the same card.
//
// Built on native overflow scrolling with snap points rather than a carousel
// library: touch, trackpad and keyboard all work without shipping anything,
// and it degrades to a plain scrollable row if JS never runs. The arrows are
// a pointer convenience on top, not the mechanism.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";

export type TeamMember = {
  id: string;
  name: string;
  /** Already-formatted, e.g. "Sector Leader" or "Analyst". */
  role: string;
  avatarUrl: string | null;
  isLeader: boolean;
};

export function MemberCard({ member }: { member: TeamMember }) {
  return (
    <div className="flex h-full flex-col items-center rounded-xl bg-highlight p-3 text-center transition-colors hover:bg-accent-soft sm:p-4">
      <Avatar
        src={member.avatarUrl}
        size="lg"
        className={`sm:h-20 sm:w-20 ${
          member.isLeader ? "ring-2 ring-accent" : ""
        }`}
      />
      <p className="mt-2 text-sm font-medium leading-snug text-balance">
        {member.name}
      </p>
      <p
        className={`mt-1 text-xs leading-snug ${
          member.isLeader ? "text-accent" : "text-muted"
        }`}
      >
        {member.role}
      </p>
    </div>
  );
}

export function MemberCarousel({
  members,
  label,
}: {
  members: TeamMember[];
  label: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      // A pixel of slack: sub-pixel widths otherwise leave an arrow lit with
      // nowhere left to go.
      setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
    };
    el.addEventListener("scroll", measure, { passive: true });
    // Fires once on observe, which is also our first measurement.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  function page(direction: 1 | -1) {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(el.clientWidth * 0.8, 160),
      behavior: "smooth",
    });
  }

  return (
    <div className="relative">
      <div
        ref={scroller}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="snap-x snap-mandatory overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex gap-3">
          {members.map((m) => (
            <li key={m.id} className="w-36 shrink-0 snap-start sm:w-40">
              <MemberCard member={m} />
            </li>
          ))}
        </ul>
      </div>

      {/* Pointer affordance only — touch users swipe, keyboard users arrow. */}
      <Arrow side="left" show={edges.left} onClick={() => page(-1)} />
      <Arrow side="right" show={edges.right} onClick={() => page(1)} />
    </div>
  );
}

function Arrow({
  side,
  show,
  onClick,
}: {
  side: "left" | "right";
  show: boolean;
  onClick: () => void;
}) {
  if (!show) return null;
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Scroll left" : "Scroll right"}
      className={`absolute top-1/2 hidden -translate-y-1/2 cursor-pointer rounded-full border border-card-border bg-card-solid p-1.5 shadow-md transition-colors hover:bg-highlight sm:block ${
        side === "left" ? "-left-2" : "-right-2"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
