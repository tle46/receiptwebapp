import { ArrowLeft, RefreshCw, LockKeyhole } from "lucide-react";
import { money, type Receipt } from "./api";
import { paymentStatus } from "./ReceiptPayments";

export default function SharedReceipt({
  receipt,
  name,
  back,
  reload,
  busy,
}: {
  receipt: Receipt;
  name: (id: number) => string;
  back: () => void;
  reload: () => void;
  busy: boolean;
}) {
  return (
    <div className="shared-detail">
      <button className="back" onClick={back}>
        <ArrowLeft size={16} />
        Shared with me
      </button>
      <div className="page-heading">
        <div>
          <h1>{receipt.merchantName || "Untitled receipt"}</h1>
          <p>
            {receipt.purchaseDate
              ? new Date(receipt.purchaseDate).toLocaleString()
              : "No purchase date"}{" "}
            · {receipt.currency}
          </p>
        </div>
        <button onClick={reload} disabled={busy}>
          <RefreshCw size={15} />
          Refresh receipt
        </button>
      </div>
      <div className="view-only-note">
        <LockKeyhole size={16} />
        <span>
          Shared by {name(receipt.ownerId)} · View only. The owner manages this
          receipt.
        </span>
        <span className={`badge ${receipt.status.toLowerCase()}`}>
          {receipt.status.toLowerCase()}
        </span>
      </div>
      <div className="editor-layout">
        <section className="panel shared-items">
          <div className="panel-heading">
            <h2>
              Items <span>{receipt.items.length}</span>
            </h2>
          </div>
          {receipt.items.map((item) => (
            <div className="shared-item" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <small>
                  {item.quantity} × {money(item.unitPrice, receipt.currency)}
                </small>
                <b>{money(item.total, receipt.currency)}</b>
              </div>
              <div className="item-shares">
                {item.allocations.map((a) => (
                  <span className="share-pill" key={a.participantId}>
                    {name(
                      receipt.participants.find((p) => p.id === a.participantId)
                        ?.userId ?? -1,
                    )}{" "}
                    <b>{money(a.finalAmount || 0, receipt.currency)}</b>
                    <small>
                      {" "}
                      ·{" "}
                      {a.allocationType === "PERCENTAGE"
                        ? `${a.inputValue}%`
                        : a.allocationType === "SHARES"
                          ? `${a.inputValue} shares`
                          : a.allocationType === "EXACT"
                            ? "exact"
                            : "equal"}
                    </small>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
        <aside className="summary-column">
          <section className="panel live-totals saved-balances">
            <h2>Saved balances</h2>
            <p>
              {receipt.status === "DRAFT"
                ? "Draft amounts may be zero or reflect an earlier calculation. Only the owner can recalculate."
                : "Amounts calculated by the owner."}
            </p>
            {receipt.participants.map((p) => (
              <div className="summary-line" key={p.id}>
                <span>{name(p.userId)}</span>
                <strong>
                  {money(p.finalOwedAmount || 0, receipt.currency)}
                </strong>
                <small
                  className={`payment-status ${paymentStatus(receipt, p).toLowerCase()}`}
                >
                  {paymentStatus(receipt, p)}
                </small>
              </div>
            ))}
          </section>
          <section className="panel summary">
            <h2>Receipt total</h2>
            {(["subtotal", "discount", "tax", "fee", "tip"] as const).map(
              (k) => (
                <div className="summary-line" key={k}>
                  <span>{k}</span>
                  <span>
                    {k === "discount" ? "−" : ""}
                    {money(receipt[k], receipt.currency)}
                  </span>
                </div>
              ),
            )}
            <div className="summary-total">
              <span>Total</span>
              <strong>{money(receipt.total, receipt.currency)}</strong>
            </div>
          </section>
        </aside>
      </div>
      {!!receipt.adjustmentAllocations.length && (
        <section className="panel form-card shared-adjustments">
          <h2>Custom adjustments</h2>
          {receipt.adjustmentAllocations.map((a, i) => (
            <div className="summary-line" key={i}>
              <span>
                {a.adjustmentType.toLowerCase()} · {name(a.userId)}
              </span>
              <strong>{money(a.amount, receipt.currency)}</strong>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
