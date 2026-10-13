import type { Draft, Item, Method } from "./api";

export const cents = (value: number) =>
  Math.round((value + Number.EPSILON) * 100);
export const round = (value: number) => cents(value) / 100;
export function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map((w) => (cents(total) * w) / sum);
  const result = raw.map(Math.floor);
  let remaining = cents(total) - result.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, fraction: v - result[i] }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { i } of order) {
    if (remaining-- > 0) result[i]++;
  }
  return result.map((v) => v / 100);
}
export function itemPreview(item: Item): Record<number, number> {
  const total = round(item.quantity * item.unitPrice);
  const method = item.allocations[0]?.allocationType;
  const values = item.allocations.map((a) => a.inputValue);
  const amounts =
    method === "EXACT"
      ? values
      : method === "PERCENTAGE"
        ? distribute((total * values.reduce((n, v) => n + v, 0)) / 100, values)
        : distribute(total, method === "EQUAL" ? values.map(() => 1) : values);
  return Object.fromEntries(
    item.allocations.map((a, i) => [a.userId, amounts[i]]),
  );
}
export function receiptPreview(draft: Draft) {
  const ids = draft.participantUserIds;
  const items = draft.items.map(itemPreview);
  const base = ids.map((id) =>
    round(items.reduce((sum, row) => sum + (row[id] || 0), 0)),
  );
  const totals = [...base];
  for (const type of ["tax", "fee", "tip", "discount"] as const) {
    const overrides = draft.adjustmentAllocations.filter(
      (a) => a.adjustmentType === type.toUpperCase(),
    );
    const amounts = overrides.length
      ? ids.map((id) => overrides.find((a) => a.userId === id)?.amount || 0)
      : distribute(draft[type], base);
    amounts.forEach(
      (amount, i) => (totals[i] += amount * (type === "discount" ? -1 : 1)),
    );
  }
  return {
    items,
    totals: Object.fromEntries(ids.map((id, i) => [id, round(totals[i])])),
  };
}
export function allocationLimit(item: Item, userId: number) {
  const method = item.allocations[0]?.allocationType;
  if (method !== "EXACT" && method !== "PERCENTAGE") return Infinity;
  const cap = method === "EXACT" ? round(item.quantity * item.unitPrice) : 100;
  return Math.max(
    0,
    round(
      cap -
        item.allocations
          .filter((a) => a.userId !== userId)
          .reduce((s, a) => s + a.inputValue, 0),
    ),
  );
}
export function setMethod(item: Item, method: Method, ids: number[]): Item {
  const people = item.allocations.length
    ? item.allocations.map((a) => a.userId)
    : ids;
  const values =
    method === "EXACT"
      ? distribute(
          item.quantity * item.unitPrice,
          people.map(() => 1),
        )
      : method === "PERCENTAGE"
        ? distribute(
            100,
            people.map(() => 1),
          )
        : people.map(() => 1);
  return {
    ...item,
    allocations: people.map((userId, i) => ({
      userId,
      allocationType: method,
      inputValue: values[i],
    })),
  };
}
export function capExact(item: Item): Item {
  if (item.allocations[0]?.allocationType !== "EXACT") return item;
  let remaining = round(item.quantity * item.unitPrice);
  return {
    ...item,
    allocations: item.allocations.map((a) => {
      const inputValue = Math.min(a.inputValue, remaining);
      remaining = round(remaining - inputValue);
      return { ...a, inputValue };
    }),
  };
}
export function validateDraft(d: Draft): string | null {
  if (!d.items.length) return "Add at least one item.";
  for (const [index, item] of d.items.entries()) {
    if (!item.name.trim()) return `Give item ${index + 1} a name.`;
    if (item.quantity <= 0 || item.unitPrice < 0)
      return `Check the quantity and price for ${item.name}.`;
    const method = item.allocations[0]?.allocationType;
    const sum = item.allocations.reduce((n, a) => n + a.inputValue, 0);
    if (!method || sum <= 0) return `Choose who shares ${item.name}.`;
    if (
      method === "EXACT" &&
      cents(sum) !== cents(item.quantity * item.unitPrice)
    )
      return `Allocate the remaining amount for ${item.name}.`;
    if (method === "PERCENTAGE" && cents(sum) !== 10000)
      return `Percentages for ${item.name} must total 100%.`;
  }
  const subtotal = d.items.reduce(
    (n, i) => n + round(i.quantity * i.unitPrice),
    0,
  );
  if (d.discount > subtotal) return "Discount cannot exceed the item subtotal.";
  for (const type of ["tax", "fee", "tip"] as const) {
    const entries = d.adjustmentAllocations.filter(
      (a) => a.adjustmentType === type.toUpperCase(),
    );
    if (
      entries.length &&
      cents(entries.reduce((n, a) => n + a.amount, 0)) !== cents(d[type])
    )
      return `Custom ${type} allocations must match the ${type} total.`;
  }
  return null;
}
