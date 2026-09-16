// SMIF brand formatting for the backup Google Sheet (spec Section 15).
// Ported from GBH's sheets-format.ts, but parameterized by tab name/column
// count so adding a backup tab needs no formatting code. Near-black
// background (#0b0b0d), UGA red headers (#ba0c2f) with white bold text,
// Inter font, frozen header row, alternating row banding.
//
// Formatting is applied exactly once: the spreadsheet is renamed to
// "SMIF Hub — Backup" at the end, and any later call that sees that title
// returns immediately.

import type { sheets_v4 } from "googleapis";

// Brand colors (RGB 0–1)
const nearBlack = { red: 0.043, green: 0.043, blue: 0.051 }; // #0b0b0d
const bgAlt = { red: 0.078, green: 0.075, blue: 0.09 }; // #141317
const ugaRed = { red: 0.729, green: 0.047, blue: 0.184 }; // #ba0c2f
const ugaRedDark = { red: 0.55, green: 0.035, blue: 0.14 };
const softWhite = { red: 0.94, green: 0.94, blue: 0.95 };
const white = { red: 1, green: 1, blue: 1 };

export const BACKUP_SPREADSHEET_TITLE = "SMIF Hub — Backup";

export interface TabFormat {
  name: string;
  cols: number;
}

const DEFAULT_COL_WIDTH = 150;
const FIRST_COL_WIDTH = 190;
const FORMAT_ROWS = 6000; // covers Audit Log's 5,000 rows plus headroom

/**
 * Applies SMIF branding to every tab listed. Returns true when formatting
 * was applied, false when the sheet was already formatted (title check) or
 * on error (formatting is cosmetic — never fail a backup over it).
 */
export async function applyBrandFormatting(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabs: TabFormat[]
): Promise<boolean> {
  try {
    const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });

    // Already formatted once — never repaint.
    if (spreadsheet.data.properties?.title === BACKUP_SPREADSHEET_TITLE) {
      return false;
    }

    const sheetMap: Record<string, number> = {};
    for (const s of spreadsheet.data.sheets ?? []) {
      const title = s.properties?.title;
      const sheetId = s.properties?.sheetId;
      if (title && sheetId !== undefined && sheetId !== null) {
        sheetMap[title] = sheetId;
      }
    }

    // Drop the default empty "Sheet1" if it is still around.
    if (sheetMap["Sheet1"] !== undefined && (spreadsheet.data.sheets?.length ?? 0) > 1) {
      try {
        await sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ deleteSheet: { sheetId: sheetMap["Sheet1"] } }],
          },
        });
      } catch {
        // Sheet1 may hold data; leave it alone.
      }
    }

    const requests: sheets_v4.Schema$Request[] = [];

    for (const tab of tabs) {
      const sheetId = sheetMap[tab.name];
      if (sheetId === undefined) continue;

      // Tab color: UGA red.
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, tabColorStyle: { rgbColor: ugaRed } },
          fields: "tabColorStyle",
        },
      });

      // All cells: near-black background, soft white Inter text.
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: FORMAT_ROWS,
            startColumnIndex: 0,
            endColumnIndex: tab.cols,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: nearBlack,
              textFormat: {
                foregroundColorStyle: { rgbColor: softWhite },
                fontFamily: "Inter",
                fontSize: 10,
              },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      });

      // Header row: UGA red background, white bold text, centered.
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: tab.cols,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: ugaRed,
              textFormat: {
                foregroundColorStyle: { rgbColor: white },
                fontFamily: "Inter",
                fontSize: 10,
                bold: true,
              },
              horizontalAlignment: "CENTER",
              borders: {
                bottom: {
                  style: "SOLID_MEDIUM",
                  colorStyle: { rgbColor: ugaRedDark },
                },
              },
            },
          },
          fields:
            "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,borders)",
        },
      });

      // Freeze the header row.
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      });

      // Column widths: wider first column, uniform after.
      for (let i = 0; i < tab.cols; i++) {
        requests.push({
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: i,
              endIndex: i + 1,
            },
            properties: {
              pixelSize: i === 0 ? FIRST_COL_WIDTH : DEFAULT_COL_WIDTH,
            },
            fields: "pixelSize",
          },
        });
      }

      // Alternating row banding under the header.
      requests.push({
        addBanding: {
          bandedRange: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: FORMAT_ROWS,
              startColumnIndex: 0,
              endColumnIndex: tab.cols,
            },
            rowProperties: {
              firstBandColorStyle: { rgbColor: nearBlack },
              secondBandColorStyle: { rgbColor: bgAlt },
            },
          },
        },
      });
    }

    // Apply in batches of 50 requests.
    for (let i = 0; i < requests.length; i += 50) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: requests.slice(i, i + 50) },
      });
    }

    // Rename last — the title doubles as the "already formatted" flag.
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSpreadsheetProperties: {
              properties: { title: BACKUP_SPREADSHEET_TITLE },
              fields: "title",
            },
          },
        ],
      },
    });

    return true;
  } catch (err) {
    console.error("Sheet formatting error:", err);
    return false;
  }
}
