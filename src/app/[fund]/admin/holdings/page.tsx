// /[fund]/admin/holdings — add/edit holdings, bond marks, CSV uploads, cash
// movements, snapshot history import (SPEC 11.3). canExecute for the write
// tools; the admin layout already gates to officers/advisor/admin.
//
// Other pages link straight into it: ?holding=<id> opens that holding's row
// (&mode=edit|mark to pick one form), ?stale=1 starts on the stale bond
// marks, and #add-holding, #marks, #cash and #history are the sections.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { canExecute, hasFundAdminAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HoldingsAdmin } from "@/components/admin/HoldingsAdmin";
import { HoldingForm } from "@/components/admin/HoldingForm";
import { CsvTool } from "@/components/admin/MarkEntry";
import { CashMovementForm } from "@/components/admin/CashMovementForm";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader, ViewLink } from "@/components/ui/PageHeader";
import { formatCurrency, formatDate } from "@/lib/format";
import type {
  BondMark,
  CashMovement,
  Holding,
  Profile,
  Sector,
} from "@/types/domain";
import { adminTitle } from "../admin-metadata";

export const generateMetadata = adminTitle("holdings", "Manage holdings");

type CashRow = CashMovement & {
  profiles: Pick<Profile, "full_name"> | null;
};

const jumpClass =
  "inline-flex min-h-9 items-center rounded-lg bg-highlight px-3 text-sm font-medium transition-colors hover:bg-card-border";

export default async function HoldingsAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<{ holding?: string; mode?: string; stale?: string }>;
}) {
  const { fund: slug } = await params;
  const query = await searchParams;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!hasFundAdminAccess(ctx)) notFound();
  const writable = canExecute(ctx);
  const renderedAt = new Date();
  const viewHoldings = (
    <ViewLink href={`/${ctx.fund.slug}/holdings`}>View holdings</ViewLink>
  );

  if (!writable) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <PageHeader title="Manage holdings" actions={viewHoldings} />
        <p className="glass-card p-6 text-sm text-muted">
          The portfolio manager, the faculty advisor, and app admins manage
          holdings.
        </p>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const [holdingsRes, sectorsRes, marksRes, cashRes] = await Promise.all([
    supabase
      .from("holdings")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .order("is_active", { ascending: false })
      .order("name"),
    supabase
      .from("sectors")
      .select("id, name, slug")
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("bond_marks")
      .select("*")
      .order("marked_at", { ascending: false }),
    supabase
      .from("cash_movements")
      .select("*, profiles(full_name)")
      .eq("fund_id", ctx.fund.id)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const holdings = (holdingsRes.data as Holding[]) ?? [];
  const sectors =
    (sectorsRes.data as Pick<Sector, "id" | "name" | "slug">[]) ?? [];
  const cashMoves = (cashRes.data as CashRow[]) ?? [];
  const holdingIds = new Set(holdings.map((h) => h.id));
  const holdingName = new Map(
    holdings.map((h) => [h.id, h.symbol ?? h.name])
  );
  const latestMarks: Record<string, BondMark> = {};
  for (const m of (marksRes.data as BondMark[]) ?? []) {
    if (holdingIds.has(m.holding_id) && !latestMarks[m.holding_id]) {
      latestMarks[m.holding_id] = m;
    }
  }

  const isFixedIncome = ctx.fund.asset_class === "fixed_income";
  const cash = formatCurrency(Number(ctx.fund.cash_balance));
  const panel =
    query.mode === "edit" || query.mode === "mark" ? query.mode : undefined;
  const ticketsHref = `/${ctx.fund.slug}/admin/tickets`;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Manage holdings"
        description={
          isFixedIncome
            ? "Edit positions, enter bond marks and record cash. Buys and sells go through trade tickets."
            : "Edit positions and record cash. Buys and sells go through trade tickets."
        }
        actions={viewHoldings}
      />

      {/* The tools below the table, one tap away instead of a long scroll. */}
      <nav
        aria-label="On this page"
        className="flex flex-wrap items-center gap-2"
      >
        <a href="#add-holding" className={jumpClass}>
          Add a holding
        </a>
        {isFixedIncome && (
          <a href="#marks" className={jumpClass}>
            Upload marks
          </a>
        )}
        <a href="#cash" className={jumpClass}>
          Cash
          <span className="ml-1.5 text-muted tabular-nums">{cash}</span>
        </a>
        <a href="#history" className={jumpClass}>
          Import history
        </a>
      </nav>

      <HoldingsAdmin
        key={`${query.holding ?? ""}:${panel ?? ""}:${query.stale ?? ""}`}
        fund={ctx.fund.slug}
        holdings={holdings}
        sectors={sectors}
        latestMarks={latestMarks}
        staleCutoff={
          renderedAt.getTime() -
          Number(ctx.fund.settings.stale_mark_days ?? 7) * 24 * 60 * 60 * 1000
        }
        initialHoldingId={query.holding}
        initialPanel={panel}
        initialStaleOnly={query.stale === "1"}
      />

      <section id="add-holding" className="scroll-mt-20 lg:scroll-mt-6">
        <Card>
          <CardHeader title="Add a holding" />
          <div className="space-y-4 p-4 sm:p-6">
            <p className="text-sm text-muted">
              Buying something new? Create a buy ticket in{" "}
              <Link
                href={ticketsHref}
                className="font-medium text-accent-text hover:underline"
              >
                Manage tickets
              </Link>{" "}
              instead: it records the trade and the cash. Add a holding here
              only for a position the fund already owns, such as a transfer
              in or a correction.
            </p>
            <HoldingForm
              fund={ctx.fund.slug}
              sectors={sectors}
              defaultInstrument={isFixedIncome ? "treasury" : "equity"}
            />
          </div>
        </Card>
      </section>

      {isFixedIncome && (
        <section id="marks" className="scroll-mt-20 lg:scroll-mt-6">
          <Card>
            <CardHeader title="Upload marks CSV" />
            <div className="space-y-3 p-4 sm:p-6">
              <p className="text-sm text-muted">
                For one bond, use Enter mark on its row in the table.
              </p>
              <CsvTool
                title="Weekly Bloomberg marks"
                hint="Columns: cusip,clean_price,ytm,duration,source,marked_at, matched to holdings by CUSIP."
                placeholder={"cusip,clean_price,ytm,duration,source,marked_at\n26442CBD5,98.750,5.125,7.2,bloomberg,2026-09-12"}
                endpoint={`/api/${ctx.fund.slug}/marks/csv`}
                successVerb="Inserted"
                countKey="inserted"
                noun="marks"
              />
            </div>
          </Card>
        </section>
      )}

      <section id="cash" className="scroll-mt-20 lg:scroll-mt-6">
        <Card>
          <CardHeader
            title="Cash"
            action={
              <span className="text-sm font-semibold tabular-nums">{cash}</span>
            }
          />
          <div className="space-y-5 p-4 sm:p-6">
            <div>
              <p className="mb-3 text-sm text-muted">
                Record dividends, coupons, contributions and fees here. Trades
                move cash on their own when a ticket is executed.
              </p>
              <CashMovementForm
                fund={ctx.fund.slug}
                holdings={holdings.filter((h) => h.is_active)}
              />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                Recent cash movements
              </h3>
              {cashMoves.length === 0 ? (
                <p className="text-sm text-muted">None recorded yet.</p>
              ) : (
                <ul className="divide-y divide-card-border/50 text-sm">
                  {cashMoves.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2"
                    >
                      <span className="min-w-0">
                        <span className="font-medium capitalize">
                          {c.kind}
                        </span>
                        {c.holding_id && holdingName.has(c.holding_id) && (
                          <span className="text-muted">
                            {" "}
                            · {holdingName.get(c.holding_id)}
                          </span>
                        )}
                        <span className="block text-xs text-muted">
                          {formatDate(c.occurred_on)}
                          {c.profiles?.full_name
                            ? ` · ${c.profiles.full_name}`
                            : ""}
                          {c.notes ? ` · ${c.notes}` : ""}
                        </span>
                      </span>
                      <span
                        className={`font-medium tabular-nums ${
                          Number(c.amount) < 0 ? "text-loss" : "text-gain"
                        }`}
                      >
                        {Number(c.amount) > 0 ? "+" : ""}
                        {formatCurrency(Number(c.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      </section>

      <section id="history" className="scroll-mt-20 lg:scroll-mt-6">
        <Card>
          <CardHeader title="Import snapshot history" />
          <div className="p-4 sm:p-6">
            <CsvTool
              title="Backfill fund values"
              hint="Columns: date,total_value,cash. Extends the performance chart with monthly values from old newsletters."
              placeholder={"date,total_value,cash\n2024-09-30,4321000,45000"}
              endpoint={`/api/${ctx.fund.slug}/snapshots/import`}
              successVerb="Imported"
              countKey="imported"
              noun="snapshots"
            />
          </div>
        </Card>
      </section>
    </div>
  );
}
