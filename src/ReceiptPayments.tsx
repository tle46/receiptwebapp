import { cents, money, type Receipt } from "./api";
export function paymentStatus(
  receipt: Receipt,
  participant: Receipt["participants"][number],
) {
  return receipt.status === "DRAFT"
    ? "Draft"
    : participant.settled
      ? "Paid"
      : "Unpaid";
}
export default function ReceiptPayments({
  receipt,
  name,
  busy,
  settle,
}: {
  receipt: Receipt;
  name: (userId: number) => string;
  busy: boolean;
  settle?: (participantId: number) => void;
}) {
  return (
    <section className="panel receipt-payments">
      <h2>Participant payments</h2>
      <p>
        {receipt.status === "DRAFT"
          ? "Draft shares are previews. No payment is owed yet."
          : "Original shares stay the same after payment. Payments are recorded, not transferred."}
      </p>
      {receipt.participants.map((participant) => (
        <div className="receipt-payment" key={participant.id}>
          <div>
            <strong>{name(participant.userId)}</strong>
            <span>{money(participant.finalOwedAmount, receipt.currency)}</span>
          </div>
          <span
            className={`payment-status ${paymentStatus(receipt, participant).toLowerCase()}`}
          >
            {paymentStatus(receipt, participant)}
            {participant.userId === receipt.ownerId ? " · Owner" : ""}
          </span>
          {settle &&
            receipt.status === "FINALIZED" &&
            participant.userId !== receipt.ownerId &&
            !participant.settled &&
            cents(participant.finalOwedAmount) > 0n && (
              <button disabled={busy} onClick={() => settle(participant.id)}>
                Mark received
              </button>
            )}
        </div>
      ))}
    </section>
  );
}
