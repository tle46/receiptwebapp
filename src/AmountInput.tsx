import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  onChange: (n: number) => void;
  label?: string;
  mode?: "money" | "percent" | "shares" | "quantity";
  currency?: string;
  max?: number;
  centsEntry?: boolean;
  disabled?: boolean;
};
export default function AmountInput({
  value,
  onChange,
  label,
  mode = "money",
  currency = "USD",
  max = Infinity,
  centsEntry = false,
  disabled,
}: Props) {
  const format = (n: number) => (mode === "money" ? n.toFixed(2) : String(n));
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);
  const [limited, setLimited] = useState(false);
  const explicitDecimal = useRef(false);
  useEffect(() => {
    if (!focused || Math.abs(Number(text) - value) > 0.00001)
      setText(format(value));
  }, [value, mode]);
  return (
    <span className={`amount-control ${limited ? "at-limit" : ""}`}>
      {mode === "money" && <span className="amount-unit">{currency}</span>}
      <input
        aria-label={label}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          explicitDecimal.current = false;
          e.target.select();
        }}
        onKeyDown={(e) => {
          if (
            mode !== "money" ||
            !centsEntry ||
            e.ctrlKey ||
            e.metaKey ||
            e.altKey
          )
            return;
          if (e.key === ".") {
            explicitDecimal.current = true;
            return;
          }
          if (
            explicitDecimal.current ||
            (!/^\d$/.test(e.key) && e.key !== "Backspace")
          )
            return;
          e.preventDefault();
          const selected =
            e.currentTarget.selectionStart === 0 &&
            e.currentTarget.selectionEnd === text.length;
          const current = selected ? 0 : Math.round(value * 100);
          const next =
            e.key === "Backspace"
              ? Math.floor(current / 10) / 100
              : (current * 10 + Number(e.key)) / 100;
          if (!Number.isFinite(next)) return;
          const capped = Math.min(next, max);
          setLimited(next > max);
          setText(format(capped));
          onChange(capped);
          requestAnimationFrame(() =>
            e.currentTarget?.setSelectionRange(
              format(capped).length,
              format(capped).length,
            ),
          );
        }}
        onBlur={() => {
          setFocused(false);
          setText(format(value));
          setLimited(false);
        }}
        onChange={(e) => {
          let raw = e.target.value.replace(/,/g, "");
          if (!/^\d*\.?\d*$/.test(raw)) return;
          let number = Number(raw === "." ? 0 : raw || 0);
          if (mode === "money" && centsEntry && !raw.includes(".")) {
            number /= 100;
            raw = number.toFixed(2);
          } else if (
            mode === "money" &&
            centsEntry &&
            e.nativeEvent instanceof InputEvent &&
            e.nativeEvent.inputType === "insertText" &&
            e.nativeEvent.data !== "." &&
            raw.split(".")[1]?.length > 2
          ) {
            number = Number(raw.replace(".", "")) / 100;
            raw = number.toFixed(2);
          }
          if (!Number.isFinite(number)) return;
          const capped = Math.min(number, max);
          setLimited(number > max);
          setText(number > max ? format(capped) : raw);
          onChange(capped);
        }}
      />
      {mode === "percent" && <span className="amount-unit">%</span>}
      {mode === "shares" && <span className="amount-unit">shares</span>}
      {limited && (
        <span className="limit-note" role="status">
          Remaining allocation reached
        </span>
      )}
    </span>
  );
}
