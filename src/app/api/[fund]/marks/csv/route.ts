// POST /api/[fund]/marks/csv — bulk mark upload (SPEC 11.3). Columns:
// cusip,clean_price,ytm,duration,source,marked_at. Matches holdings by CUSIP
// within this fund, reports per-row errors, inserts the valid rows.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsv } from "@/lib/csv";
import { logAudit } from "@/lib/audit";
import type { Holding } from "@/types/domain";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ csv: z.string().min(1).max(500_000) });

const SOURCES = new Set(["bloomberg", "broker", "finra_trace", "other"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string }> }
) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canExecute(ctx)) {
    return NextResponse.json(
      { error: "Only the PM, faculty advisor, or an app admin can upload marks." },
      { status: 403 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide the CSV text." }, { status: 400 });
  }

  const rows = parseCsv(parsed.data.csv);
  if (rows.length < 2) {
    return NextResponse.json(
      { error: "The CSV needs a header row and at least one data row." },
      { status: 400 }
    );
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col("cusip") === -1 || col("clean_price") === -1) {
    return NextResponse.json(
      { error: "Header must include at least cusip and clean_price." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: holdingRows } = await supabase
    .from("holdings")
    .select("id, cusip, name")
    .eq("fund_id", ctx.fund.id)
    .eq("is_active", true);
  const byCusip = new Map(
    ((holdingRows as Pick<Holding, "id" | "cusip" | "name">[]) ?? [])
      .filter((h) => h.cusip)
      .map((h) => [String(h.cusip).toUpperCase(), h])
  );

  const errors: { row: number; message: string }[] = [];
  const inserts: Record<string, unknown>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const cusip = (cells[col("cusip")] ?? "").trim().toUpperCase();
    const holding = byCusip.get(cusip);
    if (!holding) {
      errors.push({ row: i + 1, message: `Unknown CUSIP ${cusip || "(blank)"}` });
      continue;
    }
    const price = Number(cells[col("clean_price")]);
    if (!Number.isFinite(price) || price < 1 || price > 300) {
      errors.push({ row: i + 1, message: `Bad clean_price for ${cusip}` });
      continue;
    }
    const ytmRaw = col("ytm") >= 0 ? cells[col("ytm")] : "";
    const durRaw = col("duration") >= 0 ? cells[col("duration")] : "";
    const sourceRaw =
      col("source") >= 0 ? (cells[col("source")] ?? "").trim().toLowerCase() : "";
    const markedAtRaw =
      col("marked_at") >= 0 ? (cells[col("marked_at")] ?? "").trim() : "";
    const markedAt = markedAtRaw ? new Date(markedAtRaw) : null;
    if (markedAtRaw && Number.isNaN(markedAt?.getTime())) {
      errors.push({ row: i + 1, message: `Bad marked_at for ${cusip}` });
      continue;
    }

    inserts.push({
      holding_id: holding.id,
      clean_price: price,
      ytm: ytmRaw !== "" && Number.isFinite(Number(ytmRaw)) ? Number(ytmRaw) : null,
      duration:
        durRaw !== "" && Number.isFinite(Number(durRaw)) ? Number(durRaw) : null,
      source: SOURCES.has(sourceRaw) ? sourceRaw : "other",
      marked_by: ctx.profile.id,
      ...(markedAt ? { marked_at: markedAt.toISOString() } : {}),
      notes: null,
    });
  }

  let inserted = 0;
  if (inserts.length > 0) {
    const { error } = await supabase.from("bond_marks").insert(inserts);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    inserted = inserts.length;
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "mark.csv_upload",
    entity: "bond_marks",
    after: { inserted, failed: errors.length },
  });

  return NextResponse.json({ inserted, errors });
}
