"use client";

// The one table in the app (SPEC 11.4: "every table sortable, sticky header,
// sticky first column on mobile"). Click a header to sort, click again to
// reverse; the first column stays put while the rest scrolls sideways, and
// the header stays put while the rows scroll down.
//
// Columns carry render/sortValue functions, so every caller is a client
// component — functions do not cross the server/client boundary. Pages that
// fetch on the server pass plain data into a thin "use client" wrapper.
//
// Leave sortValue off a column that has nothing to order by (an actions
// column, a rendered bar): that header stays inert rather than pretending.

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { sortByValue } from "@/lib/sort";

export interface SortableColumn<T> {
  key: string;
  label: ReactNode;
  /** Defaults to right, matching the numeric majority. */
  align?: "left" | "right";
  /** Direction of the first click on this header. Defaults to desc. */
  defaultDir?: "asc" | "desc";
  /** Omit to make the column unsortable. Null sorts to the bottom either way. */
  sortValue?: (row: T) => string | number | null;
  render: (row: T) => ReactNode;
  /** Extra classes on both th and td — responsive hiding lives here. */
  className?: string;
}

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

/** Shared by the header cell and the body cell of the pinned first column. */
const STICKY_CELL = "sticky left-0 bg-sticky backdrop-blur-xl";

/**
 * Sorting for a table whose body this component cannot render — expandable
 * rows, grouped rows. Same comparison as SortableTable, so a column sorts the
 * same way wherever it lives.
 */
export function useSortedRows<T>(
  rows: T[],
  columns: Pick<SortableColumn<T>, "key" | "sortValue" | "defaultDir">[],
  initial?: SortState
): {
  sorted: T[];
  sort: SortState | null;
  toggle: (key: string) => void;
} {
  const [sort, setSort] = useState<SortState | null>(initial ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    return sortByValue(rows, col.sortValue, sort.dir);
  }, [rows, columns, sort]);

  function toggle(key: string) {
    const col = columns.find((c) => c.key === key);
    if (!col?.sortValue) return;
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: col.defaultDir ?? "desc" }
    );
  }

  return { sorted, sort, toggle };
}

/** The clickable part of a sortable header, for a hand-rolled `th`. */
export function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: ReactNode;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1 whitespace-nowrap uppercase tracking-wider transition-colors hover:text-foreground ${
        active ? "text-foreground" : ""
      }`}
    >
      {label}
      <Icon
        className={`h-3 w-3 ${active ? "text-accent" : "opacity-40"}`}
        aria-hidden="true"
      />
    </button>
  );
}

export function SortableTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  onRowClick,
  minWidth,
  maxHeight,
  caption,
  footer,
  emptyMessage = "Nothing to show.",
}: {
  rows: T[];
  columns: SortableColumn<T>[];
  rowKey: (row: T) => string;
  /** Omit to leave the rows in the order they arrive. */
  initialSort?: SortState;
  onRowClick?: (row: T) => void;
  minWidth?: number;
  /** Caps the scroll area so the sticky header has something to stick to. */
  maxHeight?: string;
  caption?: string;
  footer?: ReactNode;
  emptyMessage?: string;
}) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    return sortByValue(rows, col.sortValue, sort.dir);
  }, [rows, columns, sort]);

  function toggleSort(col: SortableColumn<T>) {
    if (!col.sortValue) return;
    setSort((prev) =>
      prev?.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.defaultDir ?? "desc" }
    );
  }

  if (rows.length === 0) {
    return <p className="px-6 py-8 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  const clickable = onRowClick !== undefined;

  return (
    <div
      className="overflow-auto"
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full" style={minWidth ? { minWidth } : undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-wider text-muted sm:text-xs">
            {columns.map((col, i) => {
              const active = sort?.key === col.key;
              const alignRight = col.align !== "left";
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    active
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className={`sticky top-0 bg-sticky py-2.5 font-medium backdrop-blur-xl sm:py-3 ${
                    i === 0
                      ? `${STICKY_CELL} z-30 px-3 sm:px-6`
                      : "z-20 px-2 sm:px-4"
                  } ${alignRight ? "text-right" : "text-left"} ${
                    col.className ?? ""
                  }`}
                >
                  {col.sortValue ? (
                    <SortButton
                      label={col.label}
                      active={active}
                      dir={sort?.dir ?? "desc"}
                      onClick={() => toggleSort(col)}
                    />
                  ) : (
                    <span className="whitespace-nowrap">{col.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`group border-b border-card-border/50 transition-colors last:border-0 ${
                clickable ? "cursor-pointer hover:bg-highlight" : ""
              }`}
            >
              {columns.map((col, i) => (
                <td
                  key={col.key}
                  className={`py-3 text-xs sm:py-3.5 sm:text-sm ${
                    i === 0
                      ? `${STICKY_CELL} z-10 px-3 transition-colors group-hover:bg-highlight sm:px-6`
                      : "px-2 sm:px-4"
                  } ${col.align !== "left" ? "text-right" : "text-left"} ${
                    col.className ?? ""
                  }`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}
