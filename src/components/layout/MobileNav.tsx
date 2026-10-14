"use client";

// Open state for the mobile nav drawer, shared between the button and the
// drawer itself, plus the rest of the phone top bar.
//
// The button belongs in the header's flex row rather than floating over it:
// as a fixed overlay it sat on top of the fund switcher at narrow widths, and
// an unlabelled icon among other controls is easy to read past. In the flow
// it can only ever push its neighbours along.

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu } from "lucide-react";
import { SmifLogo } from "@/components/icons/SmifLogo";
import {
  FUND_SHORT_NAMES,
  currentPageName,
  votesWaitingLabel,
  type FundNavOptions,
} from "@/components/layout/fundNav";

const MobileNavContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The Menu button, so the drawer can hand focus back when it closes. */
  toggleRef: RefObject<HTMLButtonElement | null>;
} | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  return (
    <MobileNavContext.Provider value={{ open, setOpen, toggleRef }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  const context = useContext(MobileNavContext);
  if (!context) {
    throw new Error("useMobileNav must be used inside MobileNavProvider");
  }
  return context;
}

/**
 * "Menu", with the count of votes waiting on you: the Pitches badge lives
 * inside the closed drawer, so on a phone this is the only cue outside the
 * dashboard.
 */
export function MobileNavToggle({ votesWaiting = 0 }: { votesWaiting?: number }) {
  const { open, setOpen, toggleRef } = useMobileNav();
  return (
    <button
      ref={toggleRef}
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-expanded={open}
      className="flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-card-border bg-card-solid px-2.5 text-sm font-medium transition-colors hover:bg-highlight lg:hidden"
    >
      <Menu className="h-5 w-5" aria-hidden="true" />
      <span>Menu</span>
      {votesWaiting > 0 && (
        <span className="rounded-full bg-accent px-1.5 text-xs font-semibold leading-5 text-on-accent tabular-nums">
          <span aria-hidden="true">{votesWaiting}</span>
          <span className="sr-only">, {votesWaitingLabel(votesWaiting)}</span>
        </span>
      )}
    </button>
  );
}

/**
 * The rest of the phone bar: the mark and fund name, which go home, then the
 * page you are on, named as the sidebar names it ("Athena › Performance").
 * On the dashboard the full fund name stands alone.
 */
export function MobileTitle({
  nav,
  fundName,
}: {
  nav: FundNavOptions;
  fundName: string;
}) {
  const pathname = usePathname();
  const here = currentPageName(nav, pathname);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link
        href={`/${nav.fund}`}
        aria-label={`${fundName} dashboard`}
        className="flex min-h-10 shrink-0 items-center gap-2 rounded-md font-semibold"
      >
        <SmifLogo className="h-7 w-7 shrink-0" />
        <span>{here ? FUND_SHORT_NAMES[nav.fund] : fundName}</span>
      </Link>
      {here && (
        <>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted"
            aria-hidden="true"
          />
          <span className="truncate font-medium" aria-current="page">
            {here}
          </span>
        </>
      )}
    </div>
  );
}
