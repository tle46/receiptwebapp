import { round } from "./allocation";

export type ScannedItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  source: string;
};
export type ScanResult = {
  merchant: string;
  date: string;
  items: ScannedItem[];
  tax: number;
  tip: number;
  fee: number;
  discount: number;
  total: number | null;
  warnings: string[];
};
const priceAtEnd =
  /(?:\$\s*)?(-?\d{1,6}(?:[ ,]\d{3})*[.,]\d{2})\s*(?:[A-Z*]{1,3})?\s*$/i;
const amount = (s: string) =>
  Number(
    s
      .replace(/ /g, "")
      .replace(/,(?=\d{3}(?:\D|$))/g, "")
      .replace(",", "."),
  );
// Only merge matching suffix/prefix lines from adjacent photos. Repeated groceries
// within a photo are deliberately retained; the review step exposes all rows.
export function mergePhotoText(texts: string[]) {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  let lines: string[] = [];
  for (const text of texts) {
    const next = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    let overlap = 0;
    for (let n = Math.min(lines.length, next.length); n >= 2; n--) {
      if (
        lines.slice(-n).every((s, i) => normalize(s) === normalize(next[i]))
      ) {
        overlap = n;
        break;
      }
    }
    lines = [
      ...lines,
      ...(lines.length && !overlap ? ["=== NEXT PHOTO ==="] : []),
      ...next.slice(overlap),
    ];
  }
  return lines.join("\n");
}
export function parseReceipt(text: string): ScanResult {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const result: ScanResult = {
    merchant: "",
    date: "",
    items: [],
    tax: 0,
    fee: 0,
    tip: 0,
    discount: 0,
    total: null,
    warnings: [],
  };
  let afterTotal = false;
  for (const [index, line] of lines.entries()) {
    if (line === "=== NEXT PHOTO ===") {
      afterTotal = false;
      continue;
    }
    const iso = line.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    const short = line.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
    const date = iso
      ? `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`
      : short && Number(short[1]) <= 12
        ? `${short[3]}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`
        : "";
    if (date && !result.date) {
      result.date = `${date}T12:00`;
      if (short)
        result.warnings.push(
          "Check the purchase date: numeric dates may use month/day or day/month.",
        );
    }
    const match = line.match(priceAtEnd);
    if (!match) {
      if (
        !result.merchant &&
        index < 5 &&
        /[a-z]{3}/i.test(line) &&
        !/receipt|welcome|phone|tel|www\.|https|\d{3}/i.test(line)
      )
        result.merchant = line;
      continue;
    }
    const value = amount(match[1]);
    let label = line
      .slice(0, match.index)
      .replace(/\$\s*$/, "")
      .trim();
    if (/\b(sub\s*total|subtotal)\b/i.test(label)) continue;
    if (
      /\b(grand\s*total|total\s*(due|amount)?|balance\s*due|amount\s*due)\b/i.test(
        label,
      ) &&
      !/tax|saving|discount|item/i.test(label)
    ) {
      result.total = value;
      afterTotal = true;
      continue;
    }
    if (/\b(tax|hst|gst|pst|vat|qst)\b/i.test(label)) {
      result.tax = round(result.tax + value);
      continue;
    }
    if (/\b(tip|gratuity)\b/i.test(label)) {
      result.tip = round(result.tip + value);
      continue;
    }
    if (/\b(fee|service charge|delivery)\b/i.test(label)) {
      result.fee = round(result.fee + value);
      continue;
    }
    if (/\b(discount|coupon|savings)\b/i.test(label) || value < 0) {
      result.discount = round(result.discount + Math.abs(value));
      continue;
    }
    if (
      afterTotal ||
      /\b(cash|change|visa|mastercard|debit|credit|tender|payment|balance|approved|auth|card|rounding)\b/i.test(
        label,
      )
    )
      continue;
    let quantity = 1;
    const weighted = label.match(
      /^(\d+(?:\.\d+)?)\s*(?:kg|lb|lbs)?\s*[@x×]\s*\$?(\d+[.,]\d{2})\s*$/i,
    );
    if (
      weighted &&
      index > 0 &&
      !priceAtEnd.test(lines[index - 1]) &&
      /[a-z]/i.test(lines[index - 1])
    ) {
      quantity = Number(weighted[1]);
      label = lines[index - 1];
    }
    if (!/[a-z]/i.test(label)) continue;
    const qty = label.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(.+)$/i);
    if (qty) {
      quantity = Number(qty[1]);
      label = qty[2];
    }
    if (quantity <= 0 || !Number.isFinite(value)) continue;
    result.items.push({
      name: label,
      quantity,
      unitPrice: round(value / quantity),
      source: line,
    });
  }
  if (!result.merchant)
    result.warnings.push(
      "Capture the store name at the top, or enter it below.",
    );
  if (!result.date)
    result.warnings.push("Capture the purchase date, or enter it below.");
  if (!result.items.length)
    result.warnings.push(
      "No item prices found. Add a clear close-up of the item list.",
    );
  if (result.total === null)
    result.warnings.push(
      "Capture the printed total at the bottom, or enter it below.",
    );
  return result;
}
