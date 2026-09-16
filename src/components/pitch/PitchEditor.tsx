"use client";

// Pitch editor (SPEC Section 12 "Pitch editor fields"). Creates a draft
// (POST /api/[fund]/pitches) and then autosaves it — a debounced PATCH ~3s
// after the last change while dirty. Listed names come from
// /api/market/search; bonds are free text + CUSIP. Deck (PDF/PPTX) and model
// (XLSX) uploads go through the files route so storage RLS applies.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type {
  Pitch,
  PitchAction,
  PitchFile,
  PitchType,
} from "@/types/domain";

export interface EditorSector {
  id: string;
  name: string;
}
export interface EditorHolding {
  id: string;
  name: string;
  symbol: string | null;
}
export interface EditorPitchOption {
  id: string;
  title: string;
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

const THESIS_TEMPLATE = `## Business

## Thesis

## Valuation

## Risks

## Catalysts
`;

const BOND_TYPES = [
  { value: "treasury", label: "Treasury" },
  { value: "corporate", label: "Corporate" },
  { value: "agency_mbs", label: "Agency MBS" },
  { value: "municipal", label: "Municipal" },
  { value: "money_market", label: "Money market" },
];

const INPUT =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent";
const LABEL = "mb-1 block text-xs font-medium text-muted";

interface FormState {
  title: string;
  pitch_type: PitchType;
  action: PitchAction;
  sector_id: string;
  holding_id: string;
  symbol: string;
  instrument_name: string;
  instrument_type: string;
  cusip: string;
  thesis_md: string;
  target_price: string;
  proposed_amount: string;
  proposed_weight_pct: string;
  funding_source: string;
  paired_pitch_id: string;
}

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function PitchEditor({
  fund,
  mode,
  pitch = null,
  files = [],
  sectors,
  defaultSectorId,
  canPickAnySector,
  holdings,
  pitchOptions,
  isFixedIncome,
}: {
  fund: string;
  mode: "create" | "edit";
  pitch?: Pitch | null;
  files?: PitchFile[];
  sectors: EditorSector[];
  defaultSectorId: string | null;
  /** Officers/admins may pitch for any sector; members are pinned to theirs. */
  canPickAnySector: boolean;
  holdings: EditorHolding[];
  /** The fund's other pitches, for the bear-pitch link. */
  pitchOptions: EditorPitchOption[];
  isFixedIncome: boolean;
}) {
  const router = useRouter();
  const settings = (pitch?.settings ?? {}) as {
    paired_pitch_id?: string;
    cusip?: string;
  };

  const [form, setForm] = useState<FormState>({
    title: pitch?.title ?? "",
    pitch_type: pitch?.pitch_type ?? (isFixedIncome ? "single" : "bull"),
    action: pitch?.action ?? "buy",
    sector_id: pitch?.sector_id ?? defaultSectorId ?? "",
    holding_id: pitch?.holding_id ?? "",
    symbol: pitch?.symbol ?? "",
    instrument_name: pitch?.instrument_name ?? "",
    instrument_type: pitch?.instrument_type ?? "",
    cusip: settings.cusip ?? "",
    thesis_md: pitch?.thesis_md ?? THESIS_TEMPLATE,
    target_price: pitch?.target_price !== null && pitch?.target_price !== undefined ? String(pitch.target_price) : "",
    proposed_amount: pitch?.proposed_amount !== null && pitch?.proposed_amount !== undefined ? String(pitch.proposed_amount) : "",
    proposed_weight_pct: pitch?.proposed_weight_pct !== null && pitch?.proposed_weight_pct !== undefined ? String(pitch.proposed_weight_pct) : "",
    funding_source: pitch?.funding_source ?? "",
    paired_pitch_id: settings.paired_pitch_id ?? "",
  });
  const [securityMode, setSecurityMode] = useState<"listed" | "manual">(
    pitch ? (pitch.symbol ? "listed" : pitch.instrument_name ? "manual" : isFixedIncome ? "manual" : "listed") : isFixedIncome ? "manual" : "listed"
  );

  const [saveState, setSaveState] = useState<"clean" | "dirty" | "saving" | "saved" | "error">("clean");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Security search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Files
  const [fileRows, setFileRows] = useState<PitchFile[]>(files);
  const [uploading, setUploading] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const payload = useMemo(
    () => ({
      title: form.title.trim(),
      pitch_type: form.pitch_type,
      action: form.action,
      sector_id: form.sector_id,
      holding_id: form.holding_id === "" ? null : form.holding_id,
      symbol: form.symbol.trim() === "" ? null : form.symbol.trim().toUpperCase(),
      instrument_name: form.instrument_name.trim() === "" ? null : form.instrument_name.trim(),
      instrument_type: form.instrument_type === "" ? null : form.instrument_type,
      cusip: form.cusip.trim() === "" ? null : form.cusip.trim().toUpperCase(),
      thesis_md: form.thesis_md === "" ? null : form.thesis_md,
      target_price: numOrNull(form.target_price),
      proposed_amount: numOrNull(form.proposed_amount),
      proposed_weight_pct: numOrNull(form.proposed_weight_pct),
      funding_source: form.funding_source.trim() === "" ? null : form.funding_source.trim(),
      paired_pitch_id: form.paired_pitch_id === "" ? null : form.paired_pitch_id,
    }),
    [form]
  );
  const payloadJson = JSON.stringify(payload);
  const lastSavedRef = useRef<string>(mode === "edit" ? payloadJson : "");

  const save = useCallback(
    async (json: string) => {
      if (!pitch) return;
      setSaveState("saving");
      try {
        const res = await fetch(`/api/${fund}/pitches/${pitch.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: json,
        });
        if (!res.ok) {
          const body: { error?: string } = await res.json().catch(() => ({}));
          setError(body.error ?? "Autosave failed — your last change is not saved.");
          setSaveState("error");
          return;
        }
        lastSavedRef.current = json;
        setError(null);
        setSavedAt(new Date());
        setSaveState("saved");
      } catch {
        setError("Network error — your last change is not saved.");
        setSaveState("error");
      }
    },
    [fund, pitch]
  );

  // Debounced autosave (~3s after the last keystroke) while editing a draft.
  useEffect(() => {
    if (mode !== "edit" || !pitch) return;
    if (payloadJson === lastSavedRef.current) return;
    setSaveState("dirty");
    const t = setTimeout(() => {
      void save(payloadJson);
    }, 3000);
    return () => clearTimeout(t);
  }, [payloadJson, mode, pitch, save]);

  // Debounced symbol search against /api/market/search.
  useEffect(() => {
    if (securityMode !== "listed") return;
    const q = query.trim();
    if (q === "") {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`);
        const json: { results?: SearchResult[] } = await res.json();
        setResults(json.results ?? []);
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, securityMode]);

  function pickResult(r: SearchResult) {
    setForm((f) => ({
      ...f,
      symbol: r.symbol,
      instrument_name: r.name,
      instrument_type:
        r.type === "EQUITY" ? "equity" : r.type === "ETF" ? "etf" : r.type.toLowerCase(),
    }));
    setQuery("");
    setResults([]);
  }

  function pickHolding(id: string) {
    const h = holdings.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      holding_id: id,
      symbol: h?.symbol ?? f.symbol,
      instrument_name: h?.name ?? f.instrument_name,
    }));
  }

  async function handleCreate() {
    setError(null);
    if (form.title.trim() === "") {
      setError("Give the pitch a title first.");
      return;
    }
    if (form.sector_id === "") {
      setError("Pick a sector. If you have none, ask an officer to assign you to one.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/api/${fund}/pitches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payloadJson,
      });
      const json: { pitch?: Pitch; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !json.pitch) {
        setError(json.error ?? "The draft could not be created.");
        setCreating(false);
        return;
      }
      router.push(`/${fund}/pitches/${json.pitch.id}/edit`);
      router.refresh();
    } catch {
      setError("Network error — the draft was not created.");
      setCreating(false);
    }
  }

  async function handleUpload(kind: "deck" | "model", list: FileList | null) {
    const file = list?.[0];
    if (!file || !pitch) return;
    setFileError(null);
    if (file.size > 25 * 1024 * 1024) {
      setFileError("That file is over the 25MB limit.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    setUploading(kind);
    try {
      const res = await fetch(`/api/${fund}/pitches/${pitch.id}/files`, {
        method: "POST",
        body: fd,
      });
      const json: { file?: PitchFile; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !json.file) {
        setFileError(json.error ?? "Upload failed.");
      } else {
        const uploaded = json.file;
        setFileRows((rows) => [...rows.filter((r) => r.kind !== kind), uploaded]);
      }
    } catch {
      setFileError("Network error — the file was not uploaded.");
    }
    setUploading(null);
  }

  async function handleFileDelete(fileId: string) {
    if (!pitch) return;
    setFileError(null);
    try {
      const res = await fetch(`/api/${fund}/pitches/${pitch.id}/files`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
      });
      if (res.ok) {
        setFileRows((rows) => rows.filter((r) => r.id !== fileId));
      } else {
        const json: { error?: string } = await res.json().catch(() => ({}));
        setFileError(json.error ?? "The file could not be removed.");
      }
    } catch {
      setFileError("Network error — the file was not removed.");
    }
  }

  const isRebalance = form.action === "rebalance";
  const needsHolding =
    form.action === "add" || form.action === "trim" || form.action === "sell";

  const saveLabel =
    saveState === "saving" ? (
      <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>
    ) : saveState === "saved" && savedAt ? (
      `Saved ${savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    ) : saveState === "dirty" ? (
      "Unsaved changes"
    ) : saveState === "error" ? (
      "Autosave failed"
    ) : mode === "edit" ? (
      "All changes saved"
    ) : (
      "Draft not created yet"
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`text-xs ${saveState === "error" ? "text-loss" : "text-muted"}`}
        >
          {saveLabel}
        </span>
        <div className="flex items-center gap-2">
          {mode === "edit" && pitch && (
            <>
              <Link
                href={`/${fund}/pitches/${pitch.id}`}
                className="text-xs font-medium text-accent hover:underline"
              >
                View pitch page
              </Link>
              <Button
                variant="secondary"
                disabled={saveState === "saving"}
                onClick={() => void save(payloadJson)}
              >
                Save now
              </Button>
            </>
          )}
          {mode === "create" && (
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creating…" : "Create draft"}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-loss">{error}</p>}

      <div className="glass-card space-y-4 p-4 sm:p-6">
        <div>
          <label className={LABEL} htmlFor="pitch-title">Title</label>
          <input
            id="pitch-title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder={isFixedIncome ? "e.g. Extend duration with the 10y Treasury" : "e.g. NVDA — datacenter growth is underpriced"}
            maxLength={200}
            className={INPUT}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="pitch-type">Pitch type</label>
            <select
              id="pitch-type"
              value={form.pitch_type}
              onChange={(e) => set("pitch_type", e.target.value as PitchType)}
              className={INPUT}
            >
              <option value="bull">Bull (buy case)</option>
              <option value="bear">Bear (counter case)</option>
              <option value="single">Single</option>
              <option value="rebalance">Rebalance</option>
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="pitch-action">Action</label>
            <select
              id="pitch-action"
              value={form.action}
              onChange={(e) => set("action", e.target.value as PitchAction)}
              className={INPUT}
            >
              <option value="buy">Buy (new position)</option>
              <option value="add">Add to a holding</option>
              <option value="trim">Trim a holding</option>
              <option value="sell">Sell a holding</option>
              <option value="rebalance">Rebalance targets</option>
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="pitch-sector">Sector</label>
            <select
              id="pitch-sector"
              value={form.sector_id}
              onChange={(e) => set("sector_id", e.target.value)}
              disabled={!canPickAnySector}
              className={`${INPUT} disabled:opacity-60`}
            >
              <option value="">Pick a sector…</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {!canPickAnySector && (
              <p className="mt-1 text-[11px] text-muted">Pitches go in under your sector.</p>
            )}
          </div>
        </div>

        {/* ── Security ──────────────────────────────────────────────────── */}
        {!isRebalance ? (
          <div className="rounded-lg border border-input-border p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-muted">Security</span>
              <div className="ml-auto flex rounded-lg bg-highlight p-0.5 text-xs">
                {(["listed", "manual"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSecurityMode(m)}
                    className={`rounded-md px-2.5 py-1 transition-colors ${
                      securityMode === m ? "bg-accent text-white" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {m === "listed" ? "Listed (search)" : "Bond / other"}
                  </button>
                ))}
              </div>
            </div>

            {needsHolding && (
              <div className="mb-3">
                <label className={LABEL} htmlFor="pitch-holding">Existing holding</label>
                <select
                  id="pitch-holding"
                  value={form.holding_id}
                  onChange={(e) => pickHolding(e.target.value)}
                  className={INPUT}
                >
                  <option value="">Pick the holding this pitch is about…</option>
                  {holdings.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.symbol ? `${h.symbol} — ${h.name}` : h.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {securityMode === "listed" ? (
              <div className="relative">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search a ticker or company name…"
                    className={`${INPUT} pl-9`}
                  />
                </div>
                {(results.length > 0 || searching) && query.trim() !== "" && (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-card-border bg-card-solid shadow-lg">
                    {searching && results.length === 0 && (
                      <li className="px-3 py-2 text-sm text-muted">Searching…</li>
                    )}
                    {results.map((r) => (
                      <li key={`${r.symbol}-${r.exchange}`}>
                        <button
                          type="button"
                          onClick={() => pickResult(r)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-highlight"
                        >
                          <span className="font-medium">{r.symbol}</span>
                          <span className="min-w-0 flex-1 truncate text-muted">{r.name}</span>
                          <span className="text-[10px] uppercase text-muted">{r.exchange}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {form.symbol !== "" && (
                  <p className="mt-2 flex items-center gap-2 text-sm">
                    <span className="rounded-md bg-accent-soft px-2 py-0.5 font-medium text-accent">
                      {form.symbol}
                    </span>
                    <span className="min-w-0 truncate text-muted">{form.instrument_name}</span>
                    <button
                      type="button"
                      aria-label="Clear security"
                      onClick={() =>
                        setForm((f) => ({ ...f, symbol: "", instrument_name: "", instrument_type: "" }))
                      }
                      className="text-muted hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </p>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className={LABEL} htmlFor="pitch-name">Instrument name</label>
                  <input
                    id="pitch-name"
                    value={form.instrument_name}
                    onChange={(e) => set("instrument_name", e.target.value)}
                    placeholder="e.g. US Treasury 4.25% 05/15/2035"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="pitch-cusip">CUSIP</label>
                  <input
                    id="pitch-cusip"
                    value={form.cusip}
                    onChange={(e) => set("cusip", e.target.value)}
                    placeholder="912810TW8"
                    maxLength={12}
                    className={INPUT}
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className={LABEL} htmlFor="pitch-itype">Instrument type</label>
                  <select
                    id="pitch-itype"
                    value={form.instrument_type}
                    onChange={(e) => set("instrument_type", e.target.value)}
                    className={INPUT}
                  >
                    <option value="">Pick a type…</option>
                    {BOND_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-lg bg-highlight px-3 py-2 text-xs text-muted">
            Rebalance pitch: put the proposed sector target table at the top of
            the thesis. If it passes, an officer applies the new targets under
            Fund Admin → Sectors — nothing changes automatically.
          </p>
        )}

        {/* ── Numbers ───────────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label className={LABEL} htmlFor="pitch-target">Target price ($)</label>
            <input
              id="pitch-target"
              type="number"
              step="0.01"
              min="0"
              value={form.target_price}
              onChange={(e) => set("target_price", e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="pitch-amount">Proposed amount ($)</label>
            <input
              id="pitch-amount"
              type="number"
              step="0.01"
              min="0"
              value={form.proposed_amount}
              onChange={(e) => set("proposed_amount", e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="pitch-weight">Proposed weight (%)</label>
            <input
              id="pitch-weight"
              type="number"
              step="0.1"
              min="0"
              value={form.proposed_weight_pct}
              onChange={(e) => set("proposed_weight_pct", e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="pitch-funding">Funding source</label>
            <input
              id="pitch-funding"
              value={form.funding_source}
              onChange={(e) => set("funding_source", e.target.value)}
              placeholder="cash, or 'sell XLI'"
              className={INPUT}
            />
          </div>
        </div>

        {/* ── Thesis ────────────────────────────────────────────────────── */}
        <div>
          <label className={LABEL} htmlFor="pitch-thesis">
            Thesis (markdown — the headings are a template, write under them)
          </label>
          <textarea
            id="pitch-thesis"
            value={form.thesis_md}
            onChange={(e) => set("thesis_md", e.target.value)}
            rows={16}
            className={`${INPUT} font-mono text-[13px] leading-relaxed`}
          />
        </div>

        {/* ── Bear pitch link ───────────────────────────────────────────── */}
        <div>
          <label className={LABEL} htmlFor="pitch-paired">
            Linked bear pitch (optional)
          </label>
          <select
            id="pitch-paired"
            value={form.paired_pitch_id}
            onChange={(e) => set("paired_pitch_id", e.target.value)}
            className={INPUT}
          >
            <option value="">None</option>
            {pitchOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted">
            Bull and bear cases are separate pitches shown together; the vote
            runs on the bull proposal.
          </p>
        </div>
      </div>

      {/* ── Files ───────────────────────────────────────────────────────── */}
      <div className="glass-card p-4 sm:p-6">
        <h2 className="text-sm font-semibold">Attachments</h2>
        {mode === "create" ? (
          <p className="mt-1 text-sm text-muted">
            Create the draft first — then you can attach the deck and model here.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input-border px-3 py-3 text-sm text-muted transition-colors hover:border-accent hover:text-foreground">
                <FileText className="h-4 w-4 shrink-0 text-accent" />
                {uploading === "deck" ? "Uploading deck…" : "Upload deck (PDF or PPTX, ≤25MB)"}
                <input
                  type="file"
                  accept=".pdf,.pptx"
                  className="hidden"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    void handleUpload("deck", e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input-border px-3 py-3 text-sm text-muted transition-colors hover:border-accent hover:text-foreground">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-accent" />
                {uploading === "model" ? "Uploading model…" : "Upload model (XLSX, ≤25MB)"}
                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    void handleUpload("model", e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {fileError && <p className="text-sm text-loss">{fileError}</p>}
            {fileRows.length > 0 ? (
              <ul className="space-y-1.5">
                {fileRows.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 rounded-lg bg-highlight px-3 py-2 text-sm"
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted">
                      {f.kind}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.file_name}`}
                      onClick={() => void handleFileDelete(f.id)}
                      className="text-muted transition-colors hover:text-loss"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">
                Nothing attached yet. Decks and models show on the pitch page
                with download links for the fund.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
