// Renders statement PDFs with jsPDF's built-in Helvetica font. Loaded on demand
// so the PDF library stays out of the initial portal bundle.
import { jsPDF } from "jspdf";
import { stamp, type Cell, type RecordTable } from "./records";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 16;
const BRAND: [number, number, number] = [15, 184, 204];
const INK: [number, number, number] = [24, 32, 30];
const DIM: [number, number, number] = [96, 110, 106];

const money = new Intl.NumberFormat("en-US");

function clean(value: Cell): string {
  return String(value)
    .replace(/[\t\r\n]+/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function display(value: Cell): string {
  if (typeof value === "number") {
    return `${value < 0 ? "-" : ""}TZS ${money.format(Math.abs(value))}`;
  }
  return clean(value);
}

function columnWidths(columns: string[], rows: Cell[][]): number[] {
  const lengths = columns.map((c, i) =>
    Math.max(c.length, ...rows.map((r) => display(r[i] ?? "").length)),
  );
  const weights = lengths.map((n) => Math.min(38, Math.max(9, n)));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / total) * CONTENT_W);
}

export interface StatementMeta {
  customerName: string;
  generatedAt: Date;
}

export function renderStatementPdf(tables: RecordTable[], meta: StatementMeta): ArrayBuffer {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  doc.setProperties({
    title: tables.length === 1 ? tables[0].title : "Prime Games customer records",
    subject: "Customer account records",
    creator: "Prime Games Portal",
  });

  function pageChrome(first: boolean): number {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text("PRIME GAMES", MARGIN, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.6);
    doc.setTextColor(DIM[0], DIM[1], DIM[2]);
    doc.text("Customer account records", PAGE_W - MARGIN, 14, { align: "right" });
    doc.text(`Generated ${stamp(meta.generatedAt.toISOString())} (EAT)`, PAGE_W - MARGIN, 18, { align: "right" });
    doc.setDrawColor(BRAND[0], BRAND[1], BRAND[2]);
    doc.setLineWidth(0.7);
    doc.line(MARGIN, 22, PAGE_W - MARGIN, 22);
    doc.setLineWidth(0.2);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.setFontSize(9);
    const who = `Customer: ${clean(meta.customerName) || "Customer"}`;
    doc.text(who, MARGIN, 28);
    if (first) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.6);
      doc.setTextColor(DIM[0], DIM[1], DIM[2]);
      doc.text("Complete account history", MARGIN, 33);
      return 39;
    }
    return 34;
  }

  function newPage(first: boolean): number {
    if (!first) doc.addPage();
    return pageChrome(first);
  }

  function tableTitle(table: RecordTable, heading: string, subtitle: string | undefined, y: number): number {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(heading ? 12.5 : 9.5);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(clean(table.title), MARGIN, y);
    y += heading ? 6 : 5;
    if (subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.8);
      doc.setTextColor(DIM[0], DIM[1], DIM[2]);
      const lines = doc.splitTextToSize(clean(subtitle), CONTENT_W);
      doc.text(lines, MARGIN, y);
      y += lines.length * 3.4 + 2.5;
    } else {
      y += 1.5;
    }
    return y;
  }

  function headerRow(columns: string[], widths: number[], y: number): number {
    doc.setFillColor(233, 239, 237);
    doc.rect(MARGIN, y, CONTENT_W, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.1);
    doc.setTextColor(52, 68, 64);
    let x = MARGIN;
    columns.forEach((c, i) => {
      doc.text(clean(c), x + 1.4, y + 4);
      x += widths[i];
    });
    return y + 6;
  }

  function sectionHeading(text: string, y: number): number {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(clean(text), MARGIN, y + 1);
    doc.setDrawColor(210, 220, 217);
    doc.line(MARGIN, y + 2.6, PAGE_W - MARGIN, y + 2.6);
    return y + 6.5;
  }

  let y = newPage(true);

  tables.forEach((table, tIdx) => {
    if (tIdx > 0) y = newPage(false);
    y = tableTitle(table, "", table.subtitle, y);

    for (const section of table.sections) {
      if (section.heading) y = sectionHeading(section.heading, y);
      const widths = columnWidths(section.columns, section.rows);
      y = headerRow(section.columns, widths, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.7);
      doc.setTextColor(INK[0], INK[1], INK[2]);

      for (const row of section.rows) {
        const cells = section.columns.map((_, i) => display(row[i] ?? ""));
        const wrapped = cells.map((text, i) => doc.splitTextToSize(text, widths[i] - 2.4));
        const lines = Math.max(1, ...wrapped.map((w: string[]) => w.length));
        const height = lines * 3.5 + 1.7;

        if (y + height > BOTTOM) {
          doc.setFont("helvetica", "bold");
          y = newPage(false);
          y = tableTitle(table, "continued", undefined, y);
          y = sectionHeading(section.heading ?? "continued", y);
          y = headerRow(section.columns, widths, y);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.7);
          doc.setTextColor(INK[0], INK[1], INK[2]);
        }

        let x = MARGIN;
        wrapped.forEach((w: string[], i) => {
          doc.text(w, x + 1.4, y + 3.9);
          x += widths[i];
        });
        doc.setDrawColor(232, 236, 235);
        doc.line(MARGIN, y + height, PAGE_W - MARGIN, y + height);
        y += height;
      }
      y += 3;
    }
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(DIM[0], DIM[1], DIM[2]);
    doc.text("Prime Games - Dar es Salaam - All amounts in TZS", MARGIN, PAGE_H - 8);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: "right" });
  }

  return doc.output("arraybuffer") as ArrayBuffer;
}
