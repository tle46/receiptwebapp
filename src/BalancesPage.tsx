import { RefreshCw, Wallet, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { cents, money, type Balances } from "./api";

export default function BalancesPage({
  balances,
  loading,
  error,
  busy,
  refresh,
  settle,
}: {
  balances: Balances | null;
  loading: boolean;
  error: string;
  busy: boolean;
  refresh: () => void;
  settle: (person: number) => void;
}) {
  return (
    <div className="balances-page">
      <div className="page-heading">
        <div>
          <h1>Balances</h1>
          <p>See what friends owe you and what you owe them.</p>
        </div>
        <button disabled={loading || busy} onClick={refresh}>
          <RefreshCw size={16} />
          Refresh balances
        </button>
      </div>
      <p className="balance-explainer">
        Only unpaid shares on finalized receipts count here. Each currency is
        separate. Net amounts are informational; payments are recorded in full.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
          <button disabled={loading || busy} onClick={refresh}>
            Try again
          </button>
        </div>
      )}
      {loading && <p role="status">Loading balances…</p>}
      {!loading && !error && balances?.currencies.length === 0 && (
        <section className="panel balances-empty">
          <Wallet size={30} />
          <h2>No outstanding balances</h2>
          <p>
            You’re all caught up. Unpaid shares will appear here after a receipt
            is finalized.
          </p>
        </section>
      )}
      {balances?.currencies.map((currency) => (
        <section
          className="panel currency-balances"
          key={currency.currency}
          aria-label={`${currency.currency} balances`}
        >
          <div className="panel-heading">
            <h2>{currency.currency}</h2>
            <span>Outstanding payments</span>
          </div>
          <div className="balance-totals">
            <div>
              <span>You owe others </span>
              <strong>{money(currency.totalOwing, currency.currency)}</strong>
            </div>
            <div>
              <span>Others owe you</span>
              <strong>{money(currency.totalOwed, currency.currency)}</strong>
            </div>
            <div>
              <span>Net</span>
              <strong>
                {money(-currency.netBalance, currency.currency)}
              </strong>
            </div>
          </div>
          <div className="balance-people">
            {currency.people.map((person) => (
              <article
                className="balance-person"
                key={person.userId}
                aria-label={`${person.displayName || person.username} ${currency.currency}`}
              >
                <div className="balance-person-name">
                  <span className="avatar">
                    {(person.displayName || person.username)
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <h3>{person.displayName || person.username}</h3>
                </div>
                <dl>
                  <div>
                    <dt>You owe {person.displayName}</dt>
                    <dd>{money(person.youOwe, currency.currency)}</dd>
                  </div>
                  <div>
                    <dt>{person.displayName} owes you</dt>
                    <dd>{money(person.owedToYou, currency.currency)}</dd>
                  </div>
                  <div>
                    <dt>Net</dt>
                    <dd>
                      {money(Math.abs(person.netBalance), currency.currency)}
                    </dd>
                  </div>
                </dl>
                {cents(person.netBalance) === 0n &&
                  cents(person.owedToYou) > 0n &&
                  cents(person.youOwe) > 0n && (
                    <p className="gross-debt-note">
                      Outstanding payments in both directions. Neither is
                      settled.
                    </p>
                  )}
                <button
                  className="primary"
                  disabled={
                    busy || loading || !!error || cents(person.owedToYou) <= 0n
                  }
                  onClick={() => settle(person.userId)}
                >
                  Mark all received
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
