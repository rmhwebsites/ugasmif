"use client";

// The ballot that pops up when a vote is open and you haven't voted. The
// fund layout passes in the open votes still waiting on this member of this
// fund (Athena members get Athena pitches, Arch members Arch ones); this
// shows the one closing soonest, with its options, and lets them vote
// without leaving the page they're on.
//
// "Later" (or Escape, or the close button) hides that pitch until the tab is
// closed; it comes back in the next one, and the badge on Pitches keeps
// counting it. On a pitch's own page the prompt stays out of the way: the
// Vote card is right there, and nobody reading one pitch wants another
// pitch's ballot on top of it.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Vote, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BallotChoices, castBallot } from "@/components/pitch/BallotChoices";
import { formatDateTime } from "@/lib/format";
import type { BallotOptionView, BallotPick } from "@/lib/ballot";

export interface PromptPitch {
  id: string;
  title: string;
  /** "Technology · pitched by Ana Diaz" */
  byline: string;
  closesAt: string;
  options: BallotOptionView[];
}

// Pitches put off with "Later", kept for as long as the tab is open. Read through
// useSyncExternalStore, so the server render and the first client render
// agree (neither shows the prompt) and every prompt on the page stays in step.
const LATER_KEY = "smif:ballot-later";
const laterListeners = new Set<() => void>();
// Where "Later" lives when the browser refuses sessionStorage (some private
// windows): it then lasts until the page reloads.
let laterFallback = "[]";

function subscribeLater(onChange: () => void) {
  laterListeners.add(onChange);
  return () => {
    laterListeners.delete(onChange);
  };
}

function laterSnapshot(): string {
  try {
    return window.sessionStorage.getItem(LATER_KEY) ?? "[]";
  } catch {
    return laterFallback;
  }
}

function putOffPitch(id: string) {
  const ids = new Set(JSON.parse(laterSnapshot()) as string[]).add(id);
  const next = JSON.stringify([...ids]);
  try {
    window.sessionStorage.setItem(LATER_KEY, next);
  } catch {
    laterFallback = next;
  }
  laterListeners.forEach((fn) => fn());
}

export function BallotPrompt({ fund, pitches }: { fund: string; pitches: PromptPitch[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // null on the server and during hydration: no prompt until the browser can
  // say what was put off.
  const laterRaw = useSyncExternalStore(subscribeLater, laterSnapshot, () => null);
  const [voted, setVoted] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<string | null>(null);

  const later = laterRaw === null ? null : new Set(JSON.parse(laterRaw) as string[]);
  // /athena/pitches/<id>, not the list at /athena/pitches or /new.
  const onPitchPage = /^\/[^/]+\/pitches\/(?!new(?:\/|$))[^/]+/.test(pathname);
  const waiting =
    later === null
      ? []
      : pitches.filter(
          (p) =>
            !later.has(p.id) &&
            !voted.has(p.id) &&
            !onPitchPage
        );
  const current = waiting[0] ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (current && !dialog.open) dialog.showModal();
    if (!current && dialog.open) dialog.close();
  }, [current]);

  function putOff() {
    if (!current) return;
    putOffPitch(current.id);
    setSaved(null);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="ballot-prompt-title"
      onCancel={(e) => {
        // Escape means "Later", not "gone for good".
        e.preventDefault();
        putOff();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-card-border bg-card-solid p-0 text-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      {current && (
        // Keyed by pitch, so the next ballot starts with nothing picked.
        <PromptBallot
          key={current.id}
          fund={fund}
          pitch={current}
          saved={saved}
          more={waiting.length - 1}
          onLater={putOff}
          onVoted={() => {
            setVoted((v) => new Set(v).add(current.id));
            setSaved(`Vote saved on ${current.title}.`);
            // Updates the Pitches badge and any Vote card on the page.
            router.refresh();
          }}
        />
      )}
    </dialog>
  );
}

function PromptBallot({
  fund,
  pitch,
  saved,
  more,
  onLater,
  onVoted,
}: {
  fund: string;
  pitch: PromptPitch;
  saved: string | null;
  /** Open votes still waiting after this one. */
  more: number;
  onLater: () => void;
  onVoted: () => void;
}) {
  const router = useRouter();
  const [pick, setPick] = useState<BallotPick | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    const result = await castBallot(fund, pitch.id, pick);
    setBusy(false);
    if (result.ok) {
      onVoted();
    } else {
      setError(result.error ?? "Your vote could not be saved. Try again.");
      if (result.stale) {
        setPick(null);
        router.refresh();
      }
    }
  }

  return (
    <div className="p-5 sm:p-6">
      <div className="mb-3 flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-accent-soft p-2 text-accent-text">
          <Vote className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-text">
            Voting is open
          </p>
          {/* Focus lands here when the dialog opens, rather than on the close
              button, so the first Tab goes to the options. */}
          <h2
            id="ballot-prompt-title"
            tabIndex={-1}
            autoFocus
            className="mt-0.5 text-lg font-semibold leading-snug outline-none"
          >
            {pitch.title}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{pitch.byline}</p>
          <p className="mt-0.5 text-xs text-muted">
            Closes {formatDateTime(pitch.closesAt)} ET
          </p>
        </div>
        <button
          type="button"
          onClick={onLater}
          aria-label="Vote later"
          className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-highlight hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {saved && (
        <p className="mb-3 rounded-lg bg-gain/10 px-3 py-2 text-sm text-gain">{saved}</p>
      )}

      <BallotChoices
        name={`prompt-${pitch.id}`}
        options={pitch.options}
        value={pick}
        onChange={(p) => {
          setPick(p);
          setError(null);
        }}
        disabled={busy}
      />

      {error && <p className="mt-2 text-sm text-loss">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={busy || pick === null}>
          {busy ? "Saving…" : "Cast my vote"}
        </Button>
        <Button variant="secondary" onClick={onLater} disabled={busy}>
          Later
        </Button>
        <Link
          href={`/${fund}/pitches/${pitch.id}`}
          className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
        >
          Read the pitch
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <p className="mt-3 text-xs text-muted">
        You can change your vote until it closes.
        {more > 0 ? ` ${more} more vote${more > 1 ? "s" : ""} waiting after this one.` : ""}
      </p>
    </div>
  );
}
