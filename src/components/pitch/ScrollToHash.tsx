"use client";

// Lands a link like /[fund]/pitches/<id>#vote on its card. The browser does
// that on a full page load, but on a client-side navigation (a Vote button on
// the pitches list, the dashboard's votes card) Next looks for the anchor
// while the loading skeleton is still up, finds nothing and drops it, so the
// page opened at the top. This tries again once the real page is in place.
// The cards' scroll-margin keeps them clear of the sticky phone header.

import { useEffect } from "react";

export function ScrollToHash() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return null;
}
