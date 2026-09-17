// GET /api/avatar/[seed] — a generated stand-in portrait, for members who
// haven't uploaded a photo.
//
// The drawing is derived from the seed (a profile id), so the same person
// always gets the same face and the roster doesn't reshuffle between loads.
// Nothing personal goes into it: the seed is an opaque id, and the output is
// line art. Generated locally rather than fetched from an avatar service, so
// the team page doesn't depend on anyone else's uptime and no member id
// leaves our origin.

import { NextResponse } from "next/server";
import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";

// Deliberately narrow: this is the only shape a profile id takes, and it
// keeps the generator from being handed anything surprising.
const SEED = /^[A-Za-z0-9-]{1,64}$/;

// Soft tints so the line art reads as a tile rather than floating on the card.
const BACKGROUNDS = [
  "ecd7de",
  "d5e3ec",
  "deeacf",
  "efe3cd",
  "ddd5ec",
  "e8d8cc",
];

const CACHE = "public, max-age=31536000, s-maxage=31536000, immutable";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ seed: string }> }
) {
  const { seed } = await params;
  if (!SEED.test(seed)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const svg = createAvatar(notionists, {
    seed,
    size: 160,
    radius: 50,
    scale: 130,
    backgroundColor: BACKGROUNDS,
  }).toString();

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": CACHE,
      // We author this SVG, but it is served from our own origin, so lock it
      // down for anyone who opens the URL directly instead of via <img>.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
