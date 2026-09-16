// POST /api/[fund]/snapshots/import — backfill historical fund values from a
// CSV (date,total_value,cash) so the performance chart extends before launch
// (SPEC Section 14). Officer-gated, upserts fund_snapshots.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { isOfficer } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsv } from "@/lib/csv";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ csv: z.string().min(1).max(500_000) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string }> }
) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(isOfficer(ctx) || ctx.isFacultyAdvisor || ctx.isAppAdmin)) {
    return NextResponse.json(
      { error: "Officers only." },
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
  const dateCol = header.indexOf("date");
  const totalCol = header.indexOf("total_value");
  const cashCol = header.indexOf("cash");
  if (dateCol === -1 || totalCol === -1) {
    return NextResponse.json(
      { error: "Header must include date and total_value (cash optional)." },
      { status: 400 }
    );
  }

  const errors: { row: number; message: string }[] = [];
  const upserts: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const date = (cells[dateCol] ?? "").trim();
    const total = Number(cells[totalCol]);
    const cash = cashCol >= 0 ? Number(cells[cashCol] || 0) : 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push({ row: i + 1, message: `Bad date "${date}" (use YYYY-MM-DD)` });
      continue;
    }
    if (!Number.isFinite(total) || total <= 0) {
      errors.push({ row: i + 1, message: `Bad total_value on ${date}` });
      continue;
    }
    upserts.push({
      fund_id: ctx.fund.id,
      snapshot_date: date,
      market_value: total - (Number.isFinite(cash) ? cash : 0),
      cash: Number.isFinite(cash) ? cash : 0,
      total_value: total,
      benchmark_symbol: ctx.fund.benchmark_symbol,
      benchmark_close: null,
      benchmark_adj_close: null,
      detail: { imported: true },
    });
  }

  const supabase = await createSupabaseServerClient();
  let imported = 0;
  if (upserts.length > 0) {
    const { error } = await supabase
      .from("fund_snapshots")
      .upsert(upserts, { onConflict: "fund_id,snapshot_date" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    imported = upserts.length;
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "snapshots.import",
    entity: "fund_snapshots",
    after: { imported, failed: errors.length },
  });

  return NextResponse.json({ imported, errors });
}
