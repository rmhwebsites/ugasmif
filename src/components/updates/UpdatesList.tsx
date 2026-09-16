"use client";

// Updates feed (SPEC 11.2): pinned posts first, then newest, with unread
// highlighting driven by update_reads. On mount the visible unread posts are
// marked read via POST /api/[fund]/updates/read — the "New" badges stay for
// this visit and clear on the next one. Bodies are officer-written markdown;
// a tiny renderer covers headings, bold/italic/code, links, and lists
// without pulling in a markdown dependency.

import { useEffect, useRef, type ReactNode } from "react";
import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import type { FundSlug, FundUpdate } from "@/types/domain";

/** fund_updates row with the joins/flags the updates page selects. */
export interface UpdateListItem extends FundUpdate {
  author?: { full_name: string } | null;
  read: boolean;
}

// ── Tiny markdown renderer ──────────────────────────────────────────────────

const INLINE_TOKEN =
  /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const key = `${keyBase}-${i++}`;
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-highlight px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]("));
      const href = token.slice(token.indexOf("](") + 2, -1);
      nodes.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2 hover:opacity-80"
        >
          {label}
        </a>
      );
    } else {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Block-level pass: headings, bullet/numbered lists, paragraphs. */
function renderMarkdown(md: string): ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(" ");
    blocks.push(
      <p key={`p-${key++}`} className="text-sm leading-relaxed">
        {renderInline(text, `p-${key}`)}
      </p>
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => (
      <li key={i}>{renderInline(item, `li-${key}-${i}`)}</li>
    ));
    blocks.push(
      list.ordered ? (
        <ol
          key={`l-${key++}`}
          className="list-decimal space-y-1 pl-5 text-sm leading-relaxed"
        >
          {items}
        </ol>
      ) : (
        <ul
          key={`l-${key++}`}
          className="list-disc space-y-1 pl-5 text-sm leading-relaxed"
        >
          {items}
        </ul>
      )
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);

    if (line.trim() === "") {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(
        <p
          key={`h-${key++}`}
          className={`font-semibold ${
            heading[1].length <= 2 ? "text-base" : "text-sm"
          }`}
        >
          {renderInline(heading[2], `h-${key}`)}
        </p>
      );
    } else if (bullet) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
    } else if (numbered) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

// ── The list ────────────────────────────────────────────────────────────────

export function UpdatesList({
  updates,
  fund,
}: {
  updates: UpdateListItem[];
  fund: FundSlug;
}) {
  // Mark everything on screen as read, once. The highlight stays for this
  // visit (state came from the server) and is gone the next time.
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current) return;
    markedRef.current = true;
    const unreadIds = updates.filter((u) => !u.read).map((u) => u.id);
    if (unreadIds.length === 0) return;
    fetch(`/api/${fund}/updates/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updateIds: unreadIds }),
    }).catch(() => {
      // Read receipts are best-effort; the page still works without them.
    });
  }, [updates, fund]);

  // Defensive ordering: pinned first, then newest published.
  const ordered = [...updates].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.published_at.localeCompare(a.published_at);
  });

  return (
    <div className="space-y-3 sm:space-y-4">
      {ordered.map((update) => (
        <article
          key={update.id}
          className={`glass-card p-4 sm:p-6 ${
            !update.read ? "border-l-2 border-l-accent" : ""
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {update.pinned && (
              <Badge tone="accent">
                <Pin className="h-3 w-3" aria-hidden="true" /> Pinned
              </Badge>
            )}
            {!update.read && <Badge tone="accent">New</Badge>}
            <span className="text-xs text-muted">
              {update.author?.full_name ?? "SMIF officer"} ·{" "}
              {formatDate(update.published_at)}
            </span>
          </div>
          <h2 className="mt-2 text-base font-semibold sm:text-lg">
            {update.title}
          </h2>
          <div className="mt-2 space-y-2 text-foreground/90">
            {renderMarkdown(update.body_md)}
          </div>
        </article>
      ))}
    </div>
  );
}
