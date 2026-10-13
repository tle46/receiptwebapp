import { useConfirmation } from "./ConfirmationDialog";
import { useRef, useState } from "react";
import { Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import { money, type Draft, type Item, type Method } from "./api";
import {
  allocationLimit,
  capExact,
  itemPreview,
  round,
  setMethod,
} from "./allocation";
import AmountInput from "./AmountInput";

export default function CompactItems({
  draft,
  change,
  name,
  centsEntry,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  name: (id: number) => string;
  centsEntry: boolean;
}) {
  const { confirm } = useConfirmation();
  const [expanded, setExpanded] = useState<number | null>(null);
  const lastMethods = useRef<Record<number, Method>>({});
  function update(index: number, item: Item) {
    change({
      ...draft,
      items: draft.items.map((old, i) => (i === index ? capExact(item) : old)),
    });
  }
  return (
    <section className="panel compact-items">
      <div className="section-title">
        <h2>
          <span className="step">03</span> Items & shares
        </h2>
        <button
          className="text-button"
          onClick={async () => {
            if (
              await confirm(
                "Replace all item allocations with equal shares for everyone?",
                {
                  title: "Reset item shares?",
                  confirmLabel: "Use equal shares",
                },
              )
            )
              change({
                ...draft,
                items: draft.items.map((i) =>
                  setMethod(
                    { ...i, allocations: [] },
                    "EQUAL",
                    draft.participantUserIds,
                  ),
                ),
              });
          }}
        >
          Equal split for all
        </button>
      </div>
      <div className="compact-head">
        <span>ITEM</span>
        <span>QTY</span>
        <span>UNIT PRICE</span>
        <span>SPLIT</span>
        <span>TOTAL</span>
        <span />
      </div>
      {draft.items.map((item, index) => {
        const preview = itemPreview(item),
          method =
            item.allocations[0]?.allocationType ||
            lastMethods.current[index] ||
            "EQUAL";
        lastMethods.current[index] = method;
        const allocated = item.allocations.reduce(
          (sum, a) => sum + a.inputValue,
          0,
        );
        const remaining = round(
          (method === "PERCENTAGE" ? 100 : item.quantity * item.unitPrice) -
            allocated,
        );
        const toggleParticipant = (id: number, selected: boolean) =>
          update(index, {
            ...item,
            allocations: selected
              ? [
                  ...item.allocations,
                  {
                    userId: id,
                    allocationType: method,
                    inputValue:
                      method === "EXACT" || method === "PERCENTAGE" ? 0 : 1,
                  },
                ]
              : item.allocations.filter((a) => a.userId !== id),
          });
        const editable = expanded === index;
        return (
          <div className="compact-item" key={index}>
            <div className="compact-row">
              <input
                aria-label={`Item ${index + 1} name`}
                placeholder="Item name"
                value={item.name}
                onChange={(e) =>
                  update(index, { ...item, name: e.target.value })
                }
              />
              <AmountInput
                label={`Item ${index + 1} quantity`}
                mode="quantity"
                value={item.quantity}
                onChange={(quantity) => update(index, { ...item, quantity })}
              />
              <AmountInput
                label={`Item ${index + 1} price`}
                value={item.unitPrice}
                currency={draft.currency}
                centsEntry={centsEntry}
                onChange={(unitPrice) => update(index, { ...item, unitPrice })}
              />
              <select
                aria-label={`Item ${index + 1} split method`}
                value={method}
                onChange={(e) => {
                  update(
                    index,
                    setMethod(
                      item,
                      e.target.value as Method,
                      draft.participantUserIds,
                    ),
                  );
                  setExpanded(index);
                }}
              >
                <option value="EQUAL">Equal</option>
                <option value="EXACT">Amount</option>
                <option value="PERCENTAGE">Percent</option>
                <option value="SHARES">Shares</option>
              </select>
              <strong>
                {money(item.quantity * item.unitPrice, draft.currency)}
              </strong>
              <button
                className="icon-button"
                aria-label={`Remove item ${index + 1}`}
                disabled={draft.items.length === 1}
                onClick={async () => {
                  if (
                    await confirm(`Remove ${item.name || "this item"}?`, {
                      title: "Remove item?",
                      confirmLabel: "Remove item",
                      danger: true,
                    })
                  ) {
                    change({
                      ...draft,
                      items: draft.items.filter((_, i) => i !== index),
                    });
                    setExpanded(null);
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="item-shares">
              <button
                className="text-button"
                aria-expanded={editable}
                aria-label={`Edit shares for item ${index + 1}`}
                onClick={() => setExpanded(editable ? null : index)}
              >
                <ChevronDown size={13} />
                {editable ? "Done" : "Shares"}
              </button>
              {draft.participantUserIds.map((id) => {
                const selected = item.allocations.some((a) => a.userId === id);
                return (
                  <button
                    type="button"
                    key={id}
                    className={`share-pill participant-toggle ${selected ? "selected" : "unselected"}`}
                    aria-pressed={selected}
                    aria-label={`Toggle ${name(id)} for item ${index + 1}`}
                    onClick={() => toggleParticipant(id, !selected)}
                  >
                    <span
                      className="participant-toggle-mark"
                      aria-hidden="true"
                    >
                      {selected && <Check size={14} />}
                    </span>
                    <span>{name(id)}</span>
                    <b>
                      {money(selected ? preview[id] || 0 : 0, draft.currency)}
                    </b>
                  </button>
                );
              })}
              {(method === "EXACT" || method === "PERCENTAGE") &&
                remaining > 0 && (
                  <span className="remaining">
                    {method === "EXACT"
                      ? money(remaining, draft.currency)
                      : `${remaining}%`}{" "}
                    left
                  </span>
                )}
            </div>
            {editable && (
              <div className="compact-allocations">
                {draft.participantUserIds.map((id) => {
                  const allocation = item.allocations.find(
                    (a) => a.userId === id,
                  );
                  const max = allocationLimit(item, id);
                  const put = (inputValue: number) =>
                    update(index, {
                      ...item,
                      allocations: item.allocations.map((a) =>
                        a.userId === id ? { ...a, inputValue } : a,
                      ),
                    });
                  return (
                    <div className="compact-allocation" key={id}>
                      <label className="inline">
                        <input
                          type="checkbox"
                          checked={!!allocation}
                          onChange={(e) =>
                            toggleParticipant(id, e.target.checked)
                          }
                        />
                        {name(id)}
                      </label>
                      {allocation && method !== "EQUAL" && (
                        <>
                          <AmountInput
                            label={`Item ${index + 1} allocation for ${name(id)}`}
                            value={allocation.inputValue}
                            mode={
                              method === "EXACT"
                                ? "money"
                                : method === "PERCENTAGE"
                                  ? "percent"
                                  : "shares"
                            }
                            currency={draft.currency}
                            centsEntry={centsEntry}
                            max={max}
                            onChange={put}
                          />
                          {method !== "SHARES" && (
                            <button
                              className="rest-button"
                              onClick={() => put(max)}
                            >
                              Allocate rest
                            </button>
                          )}
                        </>
                      )}
                      <strong>{money(preview[id] || 0, draft.currency)}</strong>
                    </div>
                  );
                })}
                <small>
                  {method === "EQUAL"
                    ? "Shared evenly among checked people."
                    : method === "EXACT"
                      ? "Amounts cannot exceed the item total."
                      : method === "PERCENTAGE"
                        ? "Percentages cannot exceed 100%."
                        : "Relative weights: 2 shares gets twice as much as 1 share."}
                </small>
              </div>
            )}
          </div>
        );
      })}
      <button
        className="add-item secondary"
        onClick={() =>
          change({
            ...draft,
            items: [
              ...draft.items,
              {
                name: "",
                quantity: 1,
                unitPrice: 0,
                allocations: [],
              },
            ],
          })
        }
      >
        <Plus size={16} />
        Add item
      </button>
    </section>
  );
}
