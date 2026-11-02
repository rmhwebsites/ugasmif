"""Extract the Athena book from the FactSet SMIF holdings workbook.

    pip install openpyxl
    python3 scripts/extract-athena-book.py FactSet_SMIF_Holdings_Live_<date>.xlsx athena.json
    npm run import-athena -- athena.json            # preview
    npm run import-athena -- athena.json --apply    # write

Reads the 'Holdings Update' sheet by its headers, not fixed cells: the
positions table (Sector / Holding / Buy Date / Cost Basis / Shares Purchased /
Current Price / Current Value) down to its TOTAL row, the Cash line, and the
sector table beside it (Sector / S&P Weight / ES Targets). Stops if the
numbers don't reconcile with the sheet's own totals.

Also reads the monthly portfolio values on the 'Tracking Error' sheet (Date /
Portfolio Value / Benchmark Level), which scripts/athena-go-live.ts loads
once as the fund's performance history.

The sheet carries tickers only, so names and stock-or-ETF are left for the
import to fill in from the fund's existing rows or the ticker's quote. That
also keeps this file free of anything about what the fund holds: the output
JSON is a real portfolio and stays out of the repository.
"""
import datetime
import json
import sys

import openpyxl

# The sheet's sector labels, mapped onto Athena's sectors in the app.
SECTOR_MAP = {
    "healthcare": "Healthcare",
    "industrials": "Industrials",
    "tech": "Technology",
    "technology": "Technology",
    "comm serv": "Communication Services",
    "comm. services": "Communication Services",
    "communication services": "Communication Services",
    "staples": "Staples",
    "reit": "REITs & Materials",
    "reits": "REITs & Materials",
    "materials": "REITs & Materials",
    "reit's & materials": "REITs & Materials",
    "reits & materials": "REITs & Materials",
    "discretionary": "Consumer Discretionary",
    "consumer discretionary": "Consumer Discretionary",
    "utilities": "Energy & Utilities",
    "energy": "Energy & Utilities",
    "energy & utilities": "Energy & Utilities",
    "financials": "Financial Institutions Group",
    "financial institutions group": "Financial Institutions Group",
}


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def day(v):
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    if isinstance(v, datetime.date):
        return v.isoformat()
    return None


def main(path, out):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb["Holdings Update"]
    rows = [list(r) for r in ws.iter_rows(min_row=1, max_row=300, values_only=True)]

    # As-of date: the cell to the right of "Current Date:".
    as_of = None
    for r in rows[:10]:
        for j, c in enumerate(r):
            if isinstance(c, str) and c.strip().lower() == "current date:" and j + 1 < len(r):
                as_of = day(r[j + 1])
    if not as_of:
        raise SystemExit("no 'Current Date:' found on 'Holdings Update'")

    hdr_i = next((i for i, r in enumerate(rows) if "Holding" in r and "Shares Purchased" in r), None)
    if hdr_i is None:
        raise SystemExit("no header row with 'Holding' and 'Shares Purchased'")
    hdr = rows[hdr_i]
    col = {name: hdr.index(name) for name in (
        "Sector", "Holding", "Buy Date", "Cost Basis", "Shares Purchased",
        "Total Cost", "Current Price", "Current Value")}

    positions, cash, sheet_total = [], None, None
    for i in range(hdr_i + 1, len(rows)):
        r = rows[i]
        label = r[col["Sector"]]
        if isinstance(label, str) and label.strip().upper() == "TOTAL":
            sheet_total = num(r[col["Current Value"]])
            break
        if isinstance(label, str) and label.strip().lower() == "cash":
            cash = num(r[col["Current Value"]])
            continue
        ticker = r[col["Holding"]]
        if not ticker:
            continue
        ticker = str(ticker).strip().upper()
        sector_label = str(label).strip()
        sector = SECTOR_MAP.get(sector_label.lower())
        if not sector:
            raise SystemExit(f"row {i + 1}: unknown sector label {sector_label!r}; add it to SECTOR_MAP")
        qty, cost = num(r[col["Shares Purchased"]]), num(r[col["Cost Basis"]])
        total_cost = num(r[col["Total Cost"]])
        price, value = num(r[col["Current Price"]]), num(r[col["Current Value"]])
        if qty is None or cost is None or value is None:
            raise SystemExit(f"row {i + 1}: {ticker} is missing shares, cost or value")
        if total_cost is not None and abs(qty * cost - total_cost) > 0.01:
            raise SystemExit(f"row {i + 1}: {ticker} shares x cost != total cost")
        if price is not None and abs(qty * price - value) > 0.02:
            raise SystemExit(f"row {i + 1}: {ticker} shares x price != value")
        positions.append({
            "symbol": ticker,
            "name": None,
            "instrument_type": None,
            "sector": sector,
            "sheet_sector": sector_label,
            "quantity": qty,
            "avg_cost": cost,
            "opened_on": day(r[col["Buy Date"]]),
            "price_now": price,
            "value_now": value,
            "src": f"'Holdings Update'!row {i + 1}",
        })

    if cash is None or sheet_total is None:
        raise SystemExit("the Cash line or the TOTAL row was not found")
    symbols = [p["symbol"] for p in positions]
    dupes = sorted({s for s in symbols if symbols.count(s) > 1})
    if dupes:
        raise SystemExit(f"tickers listed twice: {dupes}")
    value = sum(p["value_now"] for p in positions) + cash
    if abs(value - sheet_total) > 0.01:
        raise SystemExit(f"positions + cash {value:,.2f} != the sheet's TOTAL {sheet_total:,.2f}")

    # Sector table: a second 'Sector' column, with 'S&P Weight' and
    # 'ES Targets' (the Equity Strategies tilt against the benchmark).
    s_col = hdr.index("Sector", col["Current Value"])
    w_col, t_col = hdr.index("S&P Weight"), hdr.index("ES Targets")
    targets = {}
    for i in range(hdr_i + 1, min(hdr_i + 25, len(rows))):
        r = rows[i]
        label = r[s_col]
        name = SECTOR_MAP.get(str(label).strip().lower()) if isinstance(label, str) else None
        bench, tilt = num(r[w_col]), num(r[t_col])
        if name and bench is not None and tilt is not None:
            targets[name] = {
                "name": name,
                "benchmark_weight_pct": round(bench * 100, 3),
                "tilt_pct": round(tilt * 100, 3),
                "target_weight_pct": round((bench + tilt) * 100, 3),
            }

    history = []
    if "Tracking Error" in wb.sheetnames:
        te = [list(r) for r in wb["Tracking Error"].iter_rows(min_row=1, max_row=400, values_only=True)]
        h_i = next((i for i, r in enumerate(te) if "Date" in r and "Portfolio Value" in r), None)
        if h_i is not None:
            d_c, v_c = te[h_i].index("Date"), te[h_i].index("Portfolio Value")
            b_c = te[h_i].index("Benchmark Level") if "Benchmark Level" in te[h_i] else None
            for r in te[h_i + 1:]:
                d, v = day(r[d_c]), num(r[v_c])
                if not d or v is None:
                    if history:
                        break  # the table ends at its first blank row
                    continue
                history.append({
                    "date": d,
                    "total_value": v,
                    "benchmark_level": num(r[b_c]) if b_c is not None else None,
                })
    dates = [h["date"] for h in history]
    if dates != sorted(set(dates)):
        raise SystemExit("'Tracking Error' dates are out of order or repeated")

    with open(out, "w") as f:
        json.dump({
            "source": "FactSet SMIF holdings workbook, 'Holdings Update'",
            "as_of": as_of,
            "cash": cash,
            "sheet_total": sheet_total,
            "positions": positions,
            "sector_targets": list(targets.values()),
            "history": history,
        }, f, indent=1)

    cost_basis = sum(p["quantity"] * p["avg_cost"] for p in positions)
    span = f" ({history[0]['date']} to {history[-1]['date']})" if history else ""
    print(f"as of {as_of}: {len(positions)} positions, cash {cash:,.2f}, "
          f"total {value:,.2f} (sheet {sheet_total:,.2f}), cost basis {cost_basis:,.2f}, "
          f"{len(targets)} sector targets, {len(history)} months of history{span} -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: extract-athena-book.py <workbook.xlsx> <out.json>")
    main(sys.argv[1], sys.argv[2])
