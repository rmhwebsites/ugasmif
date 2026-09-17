"use client";

// The company logo shown to the left of a ticker.
//
// Three things make this less trivial than an <img>:
//
//   1. The logos are not visually consistent. Some arrive as transparent PNGs
//      (McDonald's, Meta), others as artwork on a white square (Apple,
//      iShares). Dropped straight onto the dark theme the second kind renders
//      as a white box beside a floating logo, so every logo sits on the same
//      light tile — which is what the white-background ones already assume.
//
//   2. A few logos are drawn entirely in white, for dark backgrounds. Arista
//      and Lennar are, today. On the light tile those are an empty square. The
//      image comes through our own proxy, so it is same-origin and a canvas
//      can sample it without tainting: if it is nearly all white, the tile
//      flips dark and the logo shows properly. Doing it by measurement rather
//      than a hardcoded list means next year's holdings are handled too.
//
//   3. Plenty of holdings have no logo worth showing: a Treasury, a corporate
//      bond, a symbol the provider has never heard of. Those fall back to the
//      ticker's first two characters, which reads better than a broken image.

import { useState, type SyntheticEvent } from "react";

const SIZES = {
  sm: { box: "h-5 w-5", text: "text-[8px]", px: 20 },
  md: { box: "h-7 w-7", text: "text-[10px]", px: 28 },
  lg: { box: "h-10 w-10", text: "text-xs", px: 40 },
} as const;

/** Above this share of near-white visible pixels, the logo needs a dark tile. */
const WHITE_SHARE = 0.92;
/** Sampling grid. 24x24 is plenty to classify a logo and costs nothing. */
const SAMPLE = 24;

type Tone = "light" | "dark" | "unknown";

/**
 * Classifies a loaded logo as needing a light or dark tile. Returns "unknown"
 * whenever the browser will not cooperate — no canvas, a tainted context, a
 * zero-sized image — and the caller keeps the light tile it already has.
 */
function toneOf(img: HTMLImageElement): Tone {
  try {
    if (!img.naturalWidth || !img.naturalHeight) return "unknown";
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "unknown";
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);

    let visible = 0;
    let nearWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 40) continue; // transparent: not part of the artwork
      visible += 1;
      if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) nearWhite += 1;
    }
    if (visible === 0) return "unknown";
    return nearWhite / visible > WHITE_SHARE ? "dark" : "light";
  } catch {
    return "unknown"; // getImageData can throw; never break the row over it
  }
}

export function SecurityLogo({
  symbol,
  name,
  size = "sm",
  className = "",
}: {
  /** Null for instruments with no ticker, such as most bonds. */
  symbol: string | null;
  /** Used for the alt text, so a screen reader hears the company. */
  name?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [tone, setTone] = useState<Tone>("unknown");
  const { box, text, px } = SIZES[size];

  const ticker = (symbol ?? "").trim().toUpperCase();
  const initials = ticker.slice(0, 2) || "—";
  const shell = `${box} shrink-0 overflow-hidden rounded-md ${className}`;

  if (ticker === "" || failed) {
    return (
      <span
        aria-hidden="true"
        className={`${shell} flex items-center justify-center bg-highlight font-semibold ${text} text-muted`}
      >
        {initials}
      </span>
    );
  }

  return (
    <span
      className={`${shell} ring-1 ring-black/5 ${
        tone === "dark" ? "bg-neutral-900" : "bg-white"
      }`}
    >
      {/* Plain img, not next/image: these come through our own route, are
          already cached at the edge for a year, and are small enough that the
          optimizer would cost more than it saves. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/logo/${encodeURIComponent(ticker)}`}
        alt={name ? `${name} logo` : `${ticker} logo`}
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        onLoad={(e: SyntheticEvent<HTMLImageElement>) =>
          setTone(toneOf(e.currentTarget))
        }
        onError={() => setFailed(true)}
        className="h-full w-full object-contain p-0.5"
      />
    </span>
  );
}
