"use client";

// Open state for the mobile nav drawer, shared between the button and the
// drawer itself.
//
// The button belongs in the header's flex row rather than floating over it:
// as a fixed overlay it sat on top of the fund switcher at narrow widths, and
// an unlabelled icon among other controls is easy to read past. In the flow
// it can only ever push its neighbours along.

import { createContext, useContext, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";

const MobileNavContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <MobileNavContext.Provider value={{ open, setOpen }}>
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

export function MobileNavToggle() {
  const { open, setOpen } = useMobileNav();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open navigation"
      aria-expanded={open}
      // mr-auto keeps the rest of the header right-aligned.
      className="mr-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-card-border bg-card-solid px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-highlight lg:hidden"
    >
      <Menu className="h-5 w-5" />
      <span>Menu</span>
    </button>
  );
}
