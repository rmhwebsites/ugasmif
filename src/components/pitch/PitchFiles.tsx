"use client";

// The Files block on a pitch page. PDFs (decks, mostly) open inline in a
// viewer instead of only linking out — the deck is the thing you actually
// read on this page. Everything else keeps the plain download link.
//
// Every link points at /api/[fund]/pitches/[id]/files/[fileId], which signs a
// storage URL per request and redirects. A viewer left open through a long
// meeting therefore keeps working, which a one-hour signed URL baked into the
// page would not.

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ChevronDown,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Maximize2,
  Paperclip,
  X,
} from "lucide-react";

export type PitchFileLink = {
  id: string;
  kind: "deck" | "model" | "other";
  file_name: string;
};

function isPdf(name: string): boolean {
  return /\.pdf$/i.test(name.trim());
}

function KindIcon({ kind }: { kind: PitchFileLink["kind"] }) {
  const cls = "h-4 w-4 shrink-0 text-accent";
  if (kind === "deck") return <FileText className={cls} />;
  if (kind === "model") return <FileSpreadsheet className={cls} />;
  return <Paperclip className={cls} />;
}

// iOS renders a PDF in an iframe as a single unscrollable page, so there it is
// better to hand the file to the system viewer than to show a stuck page.
// useSyncExternalStore rather than an effect: the server has no navigator, and
// this keeps the first client paint matching the server's.
const NEVER_CHANGES = () => () => {};

function detectInlinePdf(): boolean {
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ claims to be a Mac; touch points give it away.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return !ios;
}

function useInlinePdfSupport(): boolean {
  return useSyncExternalStore(NEVER_CHANGES, detectInlinePdf, () => true);
}

export function PitchFiles({
  files,
  fund,
  pitchId,
}: {
  files: PitchFileLink[];
  fund: string;
  pitchId: string;
}) {
  const hrefFor = (fileId: string) =>
    `/api/${encodeURIComponent(fund)}/pitches/${encodeURIComponent(
      pitchId
    )}/files/${encodeURIComponent(fileId)}`;

  // One preview at a time — two PDF viewers on a page is a lot of scroll and a
  // lot of bytes. The first PDF starts open because that is the deck.
  const firstPdf = files.find((f) => isPdf(f.file_name));
  const [openId, setOpenId] = useState<string | null>(firstPdf?.id ?? null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const fullscreen = files.find((f) => f.id === fullscreenId) ?? null;

  return (
    <>
      <ul className="space-y-2">
        {files.map((f) => {
          const href = hrefFor(f.id);
          const previewable = isPdf(f.file_name);
          const open = openId === f.id;
          return (
            <li key={f.id}>
              {previewable ? (
                <div className="flex items-center gap-2 rounded-lg bg-highlight px-3 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : f.id)}
                    aria-expanded={open}
                    aria-label={`${open ? "Hide" : "Preview"} ${f.file_name}`}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                  >
                    <KindIcon kind={f.kind} />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {f.file_name}
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`h-4 w-4 shrink-0 text-muted transition-transform ${
                        open ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in a new tab"
                    aria-label={`Open ${f.file_name} in a new tab`}
                    className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-accent-soft hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              ) : (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg bg-highlight px-3 py-2 text-sm transition-colors hover:bg-accent-soft"
                >
                  <KindIcon kind={f.kind} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {f.file_name}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    {f.kind}
                  </span>
                </a>
              )}

              {open && (
                <PdfFrame
                  src={href}
                  name={f.file_name}
                  onExpand={() => setFullscreenId(f.id)}
                />
              )}
            </li>
          );
        })}
      </ul>

      {fullscreen && (
        <PdfOverlay
          src={hrefFor(fullscreen.id)}
          name={fullscreen.file_name}
          onClose={() => setFullscreenId(null)}
        />
      )}
    </>
  );
}

function PdfFrame({
  src,
  name,
  onExpand,
}: {
  src: string;
  name: string;
  onExpand: () => void;
}) {
  const inline = useInlinePdfSupport();

  if (!inline) {
    return (
      <div className="mt-2 rounded-lg border border-card-border bg-highlight/50 p-4 text-center">
        <FileText className="mx-auto h-6 w-6 text-accent" />
        <p className="mt-2 text-sm text-muted">
          Your browser doesn&apos;t preview PDFs inline.
        </p>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <ExternalLink className="h-4 w-4" /> Open {name}
        </a>
      </div>
    );
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-card-border">
      <div className="flex items-center justify-between gap-2 border-b border-card-border bg-highlight/60 px-3 py-1.5">
        <span className="min-w-0 truncate text-xs text-muted">{name}</span>
        <button
          type="button"
          onClick={onExpand}
          title="Expand"
          aria-label={`Expand ${name}`}
          className="shrink-0 cursor-pointer rounded p-1 text-muted transition-colors hover:bg-accent-soft hover:text-foreground"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <iframe
        src={src}
        title={name}
        loading="lazy"
        className="h-[60vh] min-h-[380px] w-full border-0 bg-white sm:h-[70vh]"
      />
    </div>
  );
}

// Escape closes the overlay, and the page behind it shouldn't scroll while
// it's covered.
function useOverlayChrome(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
}

function PdfOverlay({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  useOverlayChrome(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-50 flex flex-col bg-black/80 p-2 backdrop-blur-sm sm:p-6"
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-white">
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            title="Open in a new tab"
            aria-label={`Open ${name} in a new tab`}
            className="rounded p-2 transition-colors hover:bg-white/15"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="cursor-pointer rounded p-2 transition-colors hover:bg-white/15"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <iframe
        src={src}
        title={name}
        className="min-h-0 w-full flex-1 rounded-lg border-0 bg-white"
      />
    </div>
  );
}
