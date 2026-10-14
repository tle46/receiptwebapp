import { useConfirmation } from "./ConfirmationDialog";
import { useEffect, useRef, useState } from "react";
import SharedReceipt from "./SharedReceipt";
import BalancesPage from "./BalancesPage";
import ReceiptPayments from "./ReceiptPayments";
import PersonFields from "./PersonFields";
import CompactItems from "./CompactItems";
import AmountInput from "./AmountInput";
import ReceiptScanner from "./ReceiptScanner";
import { session as authSession, type Account } from "./session";
import AccountPanel from "./AccountPanel";
import { receiptPreview, validateDraft } from "./allocation";

import {
  ArrowUpRight,
  ArrowLeft,
  Check,
  ChevronRight,
  Coffee,
  FileText,
  Leaf,
  Plus,
  Search,
  Trash2,
  Users,
  X,
  UserRound,
  LogOut,
  FolderOpen,
  Wallet,
} from "lucide-react";
import {
  api,
  auth,
  ApiError,
  money,
  toDraft,
  cents,
  hasReceivedPayment,
  type Balances,
  type Friend,
  type Receipt,
  type Draft,
} from "./api";

const blank = (id: number): Draft => ({
  merchantName: "",
  purchaseDate: new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16),
  currency: "USD",
  discount: 0,
  tax: 0,
  fee: 0,
  tip: 0,
  participantUserIds: [id],
  items: [
    {
      name: "",
      quantity: 1,
      unitPrice: 0,
      allocations: [],
    },
  ],
  adjustmentAllocations: [],
});
export default function App({ account }: { account: Account }) {
  const { confirm, choose, isOpen: confirmationOpen } = useConfirmation();
  const owner = account;
  const [page, setPage] = useState("receipts"),
    [receipts, setReceipts] = useState<Receipt[]>([]),
    [friends, setFriends] = useState<Friend[]>([]),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [identity, setIdentity] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("ALL");
  const [active, setActive] = useState<Receipt | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [dirty, setDirty] = useState(false),
    [saveState, setSaveState] = useState("All changes saved"),
    [fields, setFields] = useState<Record<string, string>>({});
  const [scanner, setScanner] = useState(false),
    [centsEntry, setCentsEntry] = useState(
      () => localStorage.getItem("gather.cents") !== "false",
    ),
    [addPerson, setAddPerson] = useState(false);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [notice, setNotice] = useState("");
  const balanceRequest = useRef(0),
    paymentLock = useRef(false);
  const session = useRef(0);
  const listRequest = useRef(0);
  const revision = useRef(0),
    lock = useRef(false);
  useEffect(() => {
    if (!identity) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>(".modal");
    const controls = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
        ) || [],
      ).filter((el) => el.offsetParent !== null);
    controls()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIdentity(false);
      if (event.key !== "Tab") return;
      const items = controls(),
        first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    modal?.addEventListener("keydown", keyboard);
    return () => {
      modal?.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [identity]);
  const name = (id: number) => {
    if (id === owner.id)
      return `${owner.displayName || owner.username} (you)`;
    const participant = active?.participants.find((p) => p.userId === id)
      || receipts.flatMap((r) => r.participants).find(
        (p) => p.userId === id && (p.displayName || p.username),
      );
    return participant?.displayName || participant?.username
      || friends.find((f) => f.userId === id)?.displayName || `Person #${id}`;
  };
  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : "Something went wrong.");
    setFields(e instanceof ApiError ? e.fields : {});
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (!owner) return;
    const epoch = session.current,
      request = ++listRequest.current;
    setLoading(true);
    try {
      const [r, f] = await Promise.all([
        api.list(owner.id),
        api.friends(owner.id),
      ]);
      if (epoch !== session.current || request !== listRequest.current) return;
      setReceipts([
        ...new Map(r.map((receipt) => [receipt.id, receipt])).values(),
      ]);
      setFriends(f);
    } catch (e) {
      if (epoch === session.current && request === listRequest.current) fail(e);
    } finally {
      if (epoch === session.current && request === listRequest.current)
        setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [owner?.id]);
  async function refreshBalances() {
    const request = ++balanceRequest.current;
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const result = await api.balances(owner.id);
      if (!Array.isArray(result.currencies))
        throw new Error("Unexpected balances response. Please try again.");
      if (request === balanceRequest.current) setBalances(result);
    } catch (error) {
      if (request === balanceRequest.current)
        setBalanceError(
          error instanceof Error ? error.message : "Could not load balances.",
        );
    } finally {
      if (request === balanceRequest.current) setBalanceLoading(false);
    }
  }
  useEffect(() => {
    if (page === "balances") void refreshBalances();
  }, [page, owner.id]);
  async function refreshAfterPayment(affected: number[]) {
    setBalances(null);
    await Promise.all([refresh(), refreshBalances()]);
    if (active && affected.includes(active.id)) {
      try {
        const detail = await api.get(owner.id, active.id);
        setActive(detail);
        setDraft(toDraft(detail));
        setDirty(false);
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 403 || error.status === 404)
        ) {
          setActive(null);
          setDraft(null);
          setDirty(false);
          setPage("receipts");
        }
        throw error;
      }
    }
  }
  async function settlePerson(personId: number) {
    if (busy || balanceLoading || paymentLock.current || !balances) return;
    const incoming = balances.currencies.flatMap((block) =>
      block.people
        .filter(
          (person) =>
            person.userId === personId && cents(person.owedToYou) > 0n,
        )
        .map((person) => ({
          currency: block.currency,
          amount: person.owedToYou,
          name: person.displayName || person.username,
        })),
    );
    if (!incoming.length || personId === owner.id) return;
    paymentLock.current = true;
    try {
      if (
        !(await confirm(
          `Record all payments received from ${incoming[0].name}?\n\n${incoming.map((amount) => `${amount.currency}: ${money(amount.amount, amount.currency)}`).join("\n")}\n\nThis records the full incoming amounts across all currencies and finalized receipts. Any money you owe this person remains outstanding. No funds are transferred.`,
          { title: "Mark all received?", confirmLabel: "Mark all received" },
        ))
      )
        return;
      await run(async () => {
        const result = await api.settlePerson(owner.id, personId);
        const count = result.currencies.reduce(
          (total, block) => total + block.participantCount,
          0,
        );
        setNotice(
          result.affectedReceiptIds.length
            ? `Recorded ${result.currencies.map((block) => `${block.currency} ${money(block.settledAmount, block.currency)}`).join(", ")} received across ${result.affectedReceiptIds.length} receipt(s), ${count} participant share(s).`
            : "No outstanding incoming payments remained. Balances refreshed.",
        );
        await refreshAfterPayment(result.affectedReceiptIds);
      });
    } finally {
      paymentLock.current = false;
    }
  }
  async function settleParticipant(participantId: number) {
    if (
      busy ||
      paymentLock.current ||
      !active ||
      active.ownerId !== owner.id ||
      active.status !== "FINALIZED"
    )
      return;
    const participant = active.participants.find(
      (person) => person.id === participantId,
    );
    if (
      !participant ||
      participant.settled ||
      participant.userId === owner.id ||
      cents(participant.finalOwedAmount) <= 0n
    )
      return;
    paymentLock.current = true;
    try {
      if (
        !(await confirm(
          `Record ${money(participant.finalOwedAmount, active.currency)} received from ${name(participant.userId)} for this receipt? This does not transfer money.`,
          { title: "Mark payment received?", confirmLabel: "Mark received" },
        ))
      )
        return;
      await run(async () => {
        const result = await api.settleParticipant(
          owner.id,
          active.id,
          participant.id,
        );
        setActive(result);
        setDraft(toDraft(result));
        setDirty(false);
        setNotice(
          `Payment from ${name(participant.userId)} recorded. Original shares are unchanged.`,
        );
        // Full response is authoritative; lists and outstanding balances are refetched.
        setBalances(null);
        await Promise.all([refresh(), refreshBalances()]);
      });
    } finally {
      paymentLock.current = false;
    }
  }
  async function unsettleReceipt() {
    if (busy || paymentLock.current || !active || active.ownerId !== owner.id
      || active.status === "DRAFT") return;
    paymentLock.current = true;
    try {
      if (!(await confirm(
        "Reverse all recorded payments on this receipt? Positive shares owed by other participants will become outstanding again. Your own share and zero shares remain settled. No funds are transferred.",
        { title: "Unsettle receipt?", confirmLabel: "Unsettle receipt", danger: true },
      ))) return;
      await run(async () => {
        const result = await api.action<Receipt>(owner.id, active.id, "unsettle");
        setActive(result);
        setDraft(toDraft(result));
        setDirty(false);
        setNotice("Recorded payments reversed. Receipt and balances updated.");
        setBalances(null);
        await Promise.all([refresh(), refreshBalances()]);
      });
    } finally {
      paymentLock.current = false;
    }
  }
  async function logout() {
    if (busy || lock.current) return;
    if (
      !(await confirm(
        owner.status === "GUEST"
          ? "Signing out loses access to this guest account. Register first to keep your receipts. Sign out anyway?"
          : "Sign out? Unsaved changes will be discarded.",
        {
          title: "Sign out?",
          confirmLabel: "Sign out",
          cancelLabel: "Stay signed in",
          danger: true,
        },
      ))
    )
      return;
    void run(async () => {
      await auth.logout();
      authSession.set(null);
    });
  }
  function change(next: Draft) {
    revision.current++;
    setDraft(next);
    setDirty(true);
    setFields({});
    setSaveState("Unsaved changes");
  }
  async function save(): Promise<Receipt | null> {
    if (!owner || !draft || lock.current) return null;
    if (active && (active.ownerId !== owner.id || active.status !== "DRAFT"))
      throw new Error("Only the receipt owner can save changes.");
    lock.current = true;
    const rev = revision.current;
    setSaveState("Saving…");
    try {
      let receipt = active;
      if (!receipt) {
        receipt = await api.create(owner.id, draft);
        setActive(receipt);
      }
      const result = await api.save(owner.id, receipt.id, draft);
      setActive(result);
      if (rev === revision.current) {
        const saved = toDraft(result);
        // Zero entries are editor selections; the API accepts positive inputs only.
        saved.items = saved.items.map((item, index) => ({
          ...item,
          allocations: [
            ...item.allocations,
            ...draft.items[index].allocations.filter(
              (allocation) =>
                allocation.inputValue === 0 &&
                saved.participantUserIds.includes(allocation.userId) &&
                !item.allocations.some(
                  (entry) => entry.userId === allocation.userId,
                ),
            ),
          ],
        }));
        setDraft(saved);
        setDirty(false);
        setSaveState("All changes saved");
      } else {
        setSaveState("Unsaved changes");
      }
      return result;
    } catch (e) {
      setSaveState("Could not save");
      fail(e);
      throw e;
    } finally {
      lock.current = false;
    }
  }
  useEffect(() => {
    if (
      !dirty ||
      !active ||
      (active && (active.status !== "DRAFT" || active.ownerId !== owner?.id)) ||
      busy ||
      scanner ||
      confirmationOpen ||
      lock.current ||
      saveState === "Could not save"
    )
      return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [draft, dirty, active?.id, busy, saveState, scanner, confirmationOpen]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  async function leave(next: string) {
    if (lock.current) {
      setError("Please wait for the draft to finish saving.");
      return;
    }
    if (
      dirty &&
      !(await confirm("Leave this receipt and discard unsaved changes?", {
        title: "Discard changes?",
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
        danger: true,
      }))
    )
      return;
    setDraft(null);
    setActive(null);
    setDirty(false);
    setPage(next);
    setNotice("");
    if (next === "shared" && filter === "DRAFT") setFilter("ALL");
    setError("");
    void refresh();
  }
  async function open(r: Receipt) {
    const epoch = session.current;
    await run(async () => {
      let detail: Receipt;
      try {
        detail = await api.get(owner!.id, r.id);
      } catch (e) {
        if (epoch !== session.current) return;
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
          setActive(null);
          setDraft(null);
          setDirty(false);
          setPage(r.ownerId === owner?.id ? "receipts" : "shared");
          await refresh();
        }
        throw e;
      }
      if (epoch !== session.current) return;
      setActive(detail);
      setDraft(toDraft(detail));
      setDirty(false);
      setPage("editor");
      setSaveState("All changes saved");
    });
  }
  async function lifecycle(action: string) {
    await run(async () => {
      if (active && active.ownerId !== owner?.id)
        throw new Error("Only the receipt owner can change its status.");
      if (lock.current)
        throw new Error("Please wait for saving to finish, then try again.");
      if (active && action === "reopen" && hasReceivedPayment(active))
        throw new Error("Receipts with received payments cannot be reopened.");
      let r = active;
      if (action === "finalize") {
        const validation = draft && validateDraft(draft);
        if (validation) throw new Error(validation);
        r = await save();
        if (!r) return;
        await api.action(owner!.id, r.id, action);
      } else {
        await api.action(owner!.id, r!.id, action);
      }
      const detail = await api.get(owner!.id, r!.id);
      setActive(detail);
      setDraft(toDraft(detail));
      setDirty(false);
      setBalances(null);
      await Promise.all([refresh(), refreshBalances()]);
    });
  }
  const livePreview = draft ? receiptPreview(draft) : null;
  const participantView = active != null && active.ownerId !== owner?.id;
  const readOnly =
    active != null && (active.status !== "DRAFT" || participantView);
  const subtotal =
    draft?.items.reduce((n, i) => n + i.quantity * i.unitPrice, 0) || 0;
  const total = draft
    ? subtotal - draft.discount + draft.tax + draft.fee + draft.tip
    : 0;
  const ownedReceipts = receipts.filter((r) => r.ownerId === owner?.id);
  const sharedReceipts = receipts.filter(
    (r) => r.ownerId !== owner?.id && r.status !== "DRAFT",
  );
  const collection = page === "shared" ? sharedReceipts : ownedReceipts;
  const sharedSection =
    page === "shared" || (page === "editor" && participantView);
  useEffect(() => {
    if (!participantView || !active) return;
    const reload = () => {
      if (document.visibilityState === "visible") void open(active);
    };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", reload);
    };
  }, [active?.id, participantView, owner?.id]);
  const visible = collection.filter(
    (r) =>
      (filter === "ALL" || r.status === filter) &&
      (r.merchantName || "").toLowerCase().includes(search.toLowerCase()),
  );
  const badges = (status: string) => (
    <span className={`badge ${status.toLowerCase()}`}>
      <span />{" "}
      {status === "DRAFT"
        ? "Draft"
        : status === "FINALIZED"
          ? "Finalized"
          : "Settled"}
    </span>
  );
  const field = (key: keyof Draft, label: string, type = "text") => (
    <label>
      {label}
      <>
        {type === "number" ? (
          <AmountInput
            label={label}
            value={Number(draft![key])}
            currency={draft!.currency}
            centsEntry={centsEntry}
            onChange={(value) => change({ ...draft!, [key]: value })}
          />
        ) : (
          <input
            type={type}
            value={String(draft![key])}
            onChange={(e) => change({ ...draft!, [key]: e.target.value })}
          />
        )}
      </>
      {fields[key] && <small className="field-error">{fields[key]}</small>}
    </label>
  );
  return (
    <div className="app">
      <aside
        className="sidebar"
        inert={identity || scanner}
        aria-hidden={identity || scanner || undefined}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            leave("receipts");
          }}
        >
          <span className="brand-icon">
            <Leaf size={24} />
          </span>
          <span className="brand-wordmark">SplitShare</span>
        </a>
        <p className="brand-subtitle">
          Split and share receipts with your friends!
        </p>
        <div className="workspace-label">RECEIPTS</div>
        <nav aria-label="Main navigation">
          <button
            aria-label="My receipts"
            className={
              page !== "people" && page !== "balances" && !sharedSection
                ? "selected"
                : ""
            }
            onClick={() => leave("receipts")}
          >
            <FileText size={19} />
            My receipts<span className="nav-count">{ownedReceipts.length}</span>
          </button>
          <button
            aria-label="Shared with me"
            className={sharedSection ? "selected" : ""}
            onClick={() => leave("shared")}
          >
            <FolderOpen size={19} />
            Shared with me
            <span className="nav-count">{sharedReceipts.length}</span>
          </button>
          <button
            className={page === "balances" ? "selected" : ""}
            onClick={() => leave("balances")}
          >
            <Wallet size={19} />
            Balances
          </button>
          <div className="nav-divider" />
          <button
            className={page === "people" ? "selected" : ""}
            onClick={() => leave("people")}
          >
            <Users size={19} />
            People
          </button>
        </nav>
      </aside>
      <main
        inert={identity || scanner}
        aria-hidden={identity || scanner || undefined}
      >
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={14} />{" "}
            {page === "balances"
              ? "Balances"
              : page === "people"
                ? "People"
                : page === "editor"
                  ? "Receipt details"
                  : page === "shared"
                    ? "Shared with me"
                    : "My receipts"}
          </span>
          <div className="account-controls">
            <button
              className="profile top-profile"
              aria-label="Account menu"
              disabled={busy}
              onClick={() => {
                if (lock.current) return;

                setIdentity(true);
              }}
            >
              <span className="avatar">
                {owner.status === "GUEST" ? (
                  <UserRound size={18} />
                ) : (
                  (owner.displayName || owner.username)
                    .slice(0, 1)
                    .toUpperCase()
                )}
              </span>
              <span>
                <strong>
                  {owner.displayName || owner.username || "Guest"}
                </strong>
                <small>
                  {owner.status === "GUEST"
                    ? "Log in / create account"
                    : "Account settings"}
                </small>
              </span>
              <ChevronRight size={14} />
            </button>
            {owner.status !== "GUEST" && (
              <button
                className="top-logout"
                aria-label="Log out"
                title="Log out"
                disabled={busy}
                onClick={logout}
              >
                <LogOut size={17} />
                <span>Log out</span>
              </button>
            )}
          </div>
        </header>
        <div className="content">
          {owner.status === "GUEST" && (
            <div className="guest-banner">
              <span>
                Register to keep access to your receipts across browsers.
              </span>
              <button
                onClick={() => {
                  setIdentity(true);
                }}
              >
                Create account
              </button>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              <div>
                {error}
                {Object.entries(fields).map(([k, v]) => (
                  <small key={k}>
                    {k}: {v}
                  </small>
                ))}
              </div>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={18} />
              </button>
            </div>
          )}
          {notice && (
            <div className="payment-notice" role="status">
              {notice}
              <button
                aria-label="Dismiss payment notice"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "balances" && (
            <BalancesPage
              balances={balances}
              loading={balanceLoading}
              error={balanceError}
              busy={busy}
              refresh={() => void refreshBalances()}
              settle={(person) => void settlePerson(person)}
            />
          )}
          {(page === "receipts" || page === "shared") && (
            <>
              <div className="page-heading">
                <div>
                  <h1>
                    {page === "shared" ? "Shared with me" : "My receipts"}
                  </h1>
                  <p>
                    {page === "shared"
                      ? "Receipts you participate in. Only the owner can make changes."
                      : "Create, edit, and manage receipts you own."}
                  </p>
                </div>
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setDraft(blank(owner!.id));
                      setActive(null);
                      setDirty(true);
                      setPage("editor");
                      setScanner(true);
                    }}
                  >
                    Scan receipt
                  </button>
                  <button
                    className="primary"
                    disabled={!owner || busy}
                    onClick={() => {
                      setDraft(blank(owner!.id));
                      setActive(null);
                      setDirty(true);
                      setPage("editor");
                      setSaveState("Unsaved changes");
                    }}
                  >
                    <Plus size={18} />
                    New receipt
                  </button>
                </div>
              </div>
              <div className="stats">
                <div>
                  <span className="stat-icon">
                    <FileText />
                  </span>
                  <div>
                    <small>
                      {page === "shared" ? "Shared receipts" : "Owned receipts"}
                    </small>
                    <strong>{collection.length}</strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon amber">
                    <Coffee />
                  </span>
                  <div>
                    <small>
                      {page === "shared" ? "Finalized" : "In progress"}
                    </small>
                    <strong>
                      {
                        collection.filter(
                          (r) =>
                            r.status ===
                            (page === "shared" ? "FINALIZED" : "DRAFT"),
                        ).length
                      }
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon green">
                    <Check />
                  </span>
                  <div>
                    <small>Settled up</small>
                    <strong>
                      {collection.filter((r) => r.status === "SETTLED").length}
                    </strong>
                  </div>
                </div>
              </div>
              <section className="panel receipts-panel">
                <div className="panel-heading">
                  <h2>
                    {page === "shared" ? "Shared receipts" : "Owned receipts"}{" "}
                    <span>{collection.length}</span>
                  </h2>
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Search receipts"
                      placeholder="Search receipts…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div className="tabs">
                  {(page === "shared"
                    ? ["ALL", "FINALIZED", "SETTLED"]
                    : ["ALL", "DRAFT", "FINALIZED", "SETTLED"]
                  ).map((s) => (
                    <button
                      className={filter === s ? "active" : ""}
                      onClick={() => setFilter(s)}
                      key={s}
                    >
                      {s === "ALL"
                        ? "All receipts"
                        : s === "DRAFT"
                          ? "Drafts"
                          : s === "FINALIZED"
                            ? "Finalized"
                            : "Settled"}
                    </button>
                  ))}
                </div>
                {loading ? (
                  <div className="empty">Loading your receipts…</div>
                ) : visible.length ? (
                  <div className="receipt-table">
                    <div className="table-head">
                      <span>RECEIPT</span>
                      <span>DATE</span>
                      <span>STATUS</span>
                      <span>TOTAL</span>
                      <span />
                    </div>
                    {visible.map((r) => (
                      <button
                        className="receipt-row"
                        key={r.id}
                        onClick={() => void open(r)}
                      >
                        <span className="merchant">
                          <span className="merchant-icon">
                            <Coffee size={20} />
                          </span>
                          <span>
                            <strong>
                              {r.merchantName || "Untitled receipt"}
                            </strong>
                            <small>
                              {r.ownerId === owner?.id
                                ? "You own this receipt"
                                : `Shared by ${name(r.ownerId)} · View only`}
                            </small>
                          </span>
                        </span>
                        <span>
                          {r.purchaseDate
                            ? new Date(r.purchaseDate).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                },
                              )
                            : "No date"}
                        </span>
                        <span>{badges(r.status)}</span>
                        <strong>
                          {money(r.total, r.currency)}
                          <small>{r.currency}</small>
                        </strong>
                        <ArrowUpRight size={18} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <div className="empty-art">
                      <FileText size={42} />
                      <span>÷</span>
                    </div>
                    <h3>
                      {search || filter !== "ALL"
                        ? "No matching receipts"
                        : page === "shared"
                          ? "No shared receipts"
                          : "No receipts yet"}
                    </h3>
                    <p>
                      {search || filter !== "ALL"
                        ? "Try another search or filter."
                        : page === "shared"
                          ? "Receipts will appear here when another owner adds your account as a participant."
                          : "Scan a receipt or add items manually."}
                    </p>
                    {page === "shared" ? (
                      <button onClick={() => leave("receipts")}>
                        Go to my receipts
                      </button>
                    ) : !owner ? (
                      <button
                        className="primary"
                        onClick={() => setIdentity(true)}
                      >
                        Set up your workspace <ArrowUpRight size={16} />
                      </button>
                    ) : (
                      <button
                        className="primary"
                        onClick={() => {
                          setDraft(blank(owner.id));
                          setPage("editor");
                          setDirty(true);
                        }}
                      >
                        <Plus size={17} />
                        Create a receipt
                      </button>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
          {page === "people" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">CONTACTS</div>
                  <h1>People</h1>
                  <p>Add people to use in your receipts.</p>
                </div>
              </div>
              <div className="people-layout">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      Your people <span>{friends.length}</span>
                    </h2>
                  </div>
                  {loading ? (
                    <div className="empty">Loading people…</div>
                  ) : friends.length ? (
                    friends.map((f) => (
                      <div className="person-row" key={f.id}>
                        <span className="avatar">
                          {f.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{f.displayName}</strong>
                          <small>
                            {f.email || "Name-only contact"} ·{" "}
                            {f.status.toLowerCase()}
                          </small>
                        </div>
                        <button
                          aria-label={`Remove ${f.displayName}`}
                          disabled={busy}
                          onClick={async () => {
                            if (
                              await confirm(
                                `Remove ${f.displayName} from your people? Existing receipts will be kept.`,
                                {
                                  title: "Remove contact?",
                                  confirmLabel: "Remove contact",
                                  danger: true,
                                },
                              )
                            )
                              void run(async () => {
                                await api.removeFriend(owner!.id, f.userId);
                                await refresh();
                              });
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="empty">
                      <Users size={36} />
                      <h3>No contacts yet</h3>
                      <p>
                        Find an existing account by username or email, or add a
                        name-only person.
                      </p>
                    </div>
                  )}
                </section>
                <form
                  className="panel form-card"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const data = new FormData(form);
                    void run(async () => {
                      await api.addFriend(
                        owner!.id,
                        String(data.get("identifier") || ""),
                        String(data.get("displayName") || ""),
                      );
                      form.reset();
                      await refresh();
                    });
                  }}
                >
                  <h2>Add a person</h2>
                  <p>They’ll be available on your next receipt.</p>
                  <PersonFields />
                  <button className="primary" disabled={!owner || busy}>
                    <Plus size={16} />
                    Add person
                  </button>
                </form>
              </div>
            </>
          )}
          {page === "editor" && participantView && active && (
            <SharedReceipt
              receipt={active}
              name={name}
              busy={busy}
              back={() => leave("shared")}
              reload={() => void open(active)}
            />
          )}
          {page === "editor" && draft && !participantView && (
            <>
              <button className="back" onClick={() => leave("receipts")}>
                <ArrowLeft size={16} />
                All receipts
              </button>
              <div className="page-heading editor-heading">
                <div>
                  <div className="eyebrow">RECEIPT DETAILS</div>
                  <h1>{draft.merchantName || "New receipt"}</h1>
                  <p>
                    {active ? (
                      badges(active.status)
                    ) : (
                      <span className="badge draft">New draft</span>
                    )}{" "}
                    <span className="save-state" role="status">
                      {readOnly ? "Receipt is read-only" : saveState}
                    </span>
                  </p>
                </div>
                <div className="actions">
                  {!readOnly && (
                    <>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => setScanner(true)}
                      >
                        Scan receipt
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await save();
                          })
                        }
                      >
                        Save draft
                      </button>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void lifecycle("finalize")}
                      >
                        Finalize receipt <Check size={16} />
                      </button>
                    </>
                  )}
                  {active?.status === "FINALIZED" && !participantView && (
                    <>
                      {!hasReceivedPayment(active) && (
                        <button
                          disabled={busy}
                          onClick={async () => {
                            if (
                              await confirm(
                                "Reopen this receipt for editing?",
                                {
                                  title: "Reopen receipt?",
                                  confirmLabel: "Reopen receipt",
                                },
                              )
                            )
                              void lifecycle("reopen");
                          }}
                        >
                          Reopen
                        </button>
                      )}
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await confirm(
                              "Mark this receipt settled? This records all payments received and does not transfer money.",
                              {
                                title: "Mark receipt settled?",
                                confirmLabel: "Mark settled",
                              },
                            )
                          )
                            void lifecycle("settle");
                        }}
                      >
                        Mark settled <Check size={16} />
                      </button>
                    </>
                  )}
                  {active && !participantView &&
                    (active.status === "SETTLED" || hasReceivedPayment(active)) && (
                      <button disabled={busy} onClick={() => void unsettleReceipt()}>
                        Unsettle receipt
                      </button>
                    )}
                </div>
              </div>
              <div className="entry-settings">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={centsEntry}
                    onChange={(e) => {
                      setCentsEntry(e.target.checked);
                      localStorage.setItem(
                        "gather.cents",
                        String(e.target.checked),
                      );
                    }}
                  />
                  Fast cents entry
                </label>
                <small>
                  {centsEntry
                    ? "No need to type decimals :)"
                    : "Enable to automatically format decimals"}
                </small>
              </div>
              <div className="editor-layout">
                <div className="editor-main">
                  <fieldset disabled={readOnly || busy}>
                    <section className="panel form-card">
                      <h2>
                        <span className="step">01</span> The details
                      </h2>
                      <div className="details-grid">
                        {field("merchantName", "Merchant")}
                        {field("purchaseDate", "Date & time", "datetime-local")}
                        <label>
                          Currency
                          <select
                            value={draft.currency}
                            onChange={(e) =>
                              change({ ...draft, currency: e.target.value })
                            }
                          >
                            {Array.from(
                              new Set([
                                draft.currency,
                                "USD",
                                "CAD",
                                "EUR",
                                "GBP",
                                "AUD",
                                "JPY",
                              ]),
                            ).map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </section>
                    <section className="panel form-card">
                      <div className="section-title">
                        <h2>
                          <span className="step">02</span> Who was there?
                        </h2>
                        <button
                          onClick={() => setAddPerson(!addPerson)}
                          className="text-button"
                        >
                          <Plus size={14} />
                          Add person
                        </button>
                      </div>
                      <p>Select people, then choose how each item is shared.</p>
                      {addPerson && (
                        <form
                          className="inline-person-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const form = e.currentTarget;
                            const data = new FormData(form);
                            void run(async () => {
                              const f = await api.addFriend(
                                owner!.id,
                                String(data.get("identifier") || ""),
                                String(data.get("displayName") || ""),
                              );
                              setFriends((old) => [...old, f]);
                              change({
                                ...draft,
                                participantUserIds: [
                                  ...new Set([
                                    ...draft.participantUserIds,
                                    f.userId,
                                  ]),
                                ],
                              });
                              setAddPerson(false);
                            });
                          }}
                        >
                          <PersonFields />
                          <button className="primary" disabled={busy}>
                            Add to receipt
                          </button>
                        </form>
                      )}
                      <div className="chips">
                        {Array.from(
                          new Set([
                            owner!.id,
                            ...friends.map((f) => f.userId),
                            ...draft.participantUserIds,
                          ]),
                        ).map((id) => (
                          <label
                            className={`person-chip ${draft.participantUserIds.includes(id) ? "checked" : ""}`}
                            key={id}
                          >
                            <input
                              type="checkbox"
                              disabled={id === owner!.id}
                              checked={draft.participantUserIds.includes(id)}
                              onChange={(e) => {
                                const ids = e.target.checked
                                  ? [...draft.participantUserIds, id]
                                  : draft.participantUserIds.filter(
                                      (p) => p !== id,
                                    );
                                change({
                                  ...draft,
                                  participantUserIds: ids,
                                  items: draft.items.map((i) => ({
                                    ...i,
                                    allocations: i.allocations.filter((a) =>
                                      ids.includes(a.userId),
                                    ),
                                  })),
                                  adjustmentAllocations:
                                    draft.adjustmentAllocations.filter((a) =>
                                      ids.includes(a.userId),
                                    ),
                                });
                              }}
                            />
                            {name(id)}
                            {friends.find((f) => f.userId === id)?.status ===
                              "PLACEHOLDER" && <small>placeholder</small>}
                          </label>
                        ))}
                      </div>
                    </section>
                    <CompactItems
                      draft={draft}
                      change={change}
                      name={name}
                      centsEntry={centsEntry}
                    />
                    <section className="panel form-card">
                      <h2>
                        <span className="step">04</span> The extras
                      </h2>
                      <div className="extras-grid">
                        {field("discount", "Discount", "number")}
                        {field("tax", "Tax", "number")}
                        {field("fee", "Fee", "number")}
                        {field("tip", "Tip", "number")}
                      </div>
                      {(["TAX", "FEE", "TIP"] as const).map((type) => {
                        const entries = draft.adjustmentAllocations.filter(
                          (a) => a.adjustmentType === type,
                        );
                        return (
                          <div className="adjustment" key={type}>
                            <label className="inline">
                              <input
                                type="checkbox"
                                checked={entries.length > 0}
                                onChange={(e) =>
                                  change({
                                    ...draft,
                                    adjustmentAllocations: [
                                      ...draft.adjustmentAllocations.filter(
                                        (a) => a.adjustmentType !== type,
                                      ),
                                      ...(e.target.checked
                                        ? draft.participantUserIds.map(
                                            (userId) => ({
                                              adjustmentType: type,
                                              userId,
                                              amount: 0,
                                            }),
                                          )
                                        : []),
                                    ],
                                  })
                                }
                              />
                              Custom {type.toLowerCase()} allocation
                            </label>
                            {entries.length > 0 && (
                              <>
                                <div className="extras-grid">
                                  {draft.participantUserIds.map((id) => (
                                    <label key={id}>
                                      {name(id)}
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={
                                          entries.find((a) => a.userId === id)
                                            ?.amount || 0
                                        }
                                        onChange={(e) =>
                                          change({
                                            ...draft,
                                            adjustmentAllocations: [
                                              ...draft.adjustmentAllocations.filter(
                                                (a) =>
                                                  !(
                                                    a.adjustmentType === type &&
                                                    a.userId === id
                                                  ),
                                              ),
                                              {
                                                adjustmentType: type,
                                                userId: id,
                                                amount: Number(e.target.value),
                                              },
                                            ],
                                          })
                                        }
                                      />
                                    </label>
                                  ))}
                                </div>
                                <small
                                  className={
                                    Math.abs(
                                      entries.reduce(
                                        (n, a) => n + a.amount,
                                        0,
                                      ) -
                                        draft[
                                          type.toLowerCase() as
                                            "tax" | "fee" | "tip"
                                        ],
                                    ) > 0.001
                                      ? "field-error"
                                      : ""
                                  }
                                >
                                  Assigned{" "}
                                  {money(
                                    entries.reduce((n, a) => n + a.amount, 0),
                                    draft.currency,
                                  )}{" "}
                                  of{" "}
                                  {money(
                                    draft[
                                      type.toLowerCase() as
                                        "tax" | "fee" | "tip"
                                    ],
                                    draft.currency,
                                  )}
                                </small>
                              </>
                            )}
                          </div>
                        );
                      })}
                      <small>
                        Tax, fee, tip, and discount are proportional unless you
                        add a custom allocation.
                      </small>
                    </section>
                  </fieldset>
                </div>
                <aside className="summary-column">
                  {active && (
                    <ReceiptPayments
                      receipt={active}
                      name={name}
                      busy={busy}
                      settle={(participantId) =>
                        void settleParticipant(participantId)
                      }
                    />
                  )}
                  {active && hasReceivedPayment(active) && (
                    <p className="payment-lock-note">
                      Payments have been received. Unsettle this receipt before
                      reopening or deleting it.
                    </p>
                  )}
                  {(!readOnly ||
                    (participantView && active?.status === "DRAFT")) &&
                    livePreview && (
                      <section className="panel live-totals">
                        <h2>Everyone’s share</h2>
                        <p>Live estimate · includes adjustments</p>
                        {draft.participantUserIds.map((id) => (
                          <div className="summary-line" key={id}>
                            <span>{name(id)}</span>
                            <strong>
                              {money(
                                livePreview.totals[id] || 0,
                                draft.currency,
                              )}
                            </strong>
                          </div>
                        ))}
                        <small>
                          {validateDraft(draft) ||
                            "All items allocated. Finalize to confirm the split."}
                        </small>
                      </section>
                    )}
                  <section className="panel summary">
                    <div className="summary-icon">
                      <FileText size={23} />
                    </div>
                    <h2>Receipt total</h2>
                    <p>
                      {draft.items.length} item
                      {draft.items.length !== 1 ? "s" : ""} ·{" "}
                      {draft.participantUserIds.length} people
                    </p>
                    <div className="summary-line">
                      <span>Subtotal</span>
                      <span>{money(subtotal, draft.currency)}</span>
                    </div>
                    {(["discount", "tax", "fee", "tip"] as const).map((k) => (
                      <div className="summary-line" key={k}>
                        <span>{k}</span>
                        <span>
                          {k === "discount" ? "−" : ""}
                          {money(draft[k], draft.currency)}
                        </span>
                      </div>
                    ))}
                    <div className="summary-total">
                      <span>Total</span>
                      <strong>{money(total, draft.currency)}</strong>
                    </div>
                    <small>
                      {readOnly
                        ? "Saved receipt total"
                        : "Estimated total · review for the server-calculated split"}
                    </small>
                  </section>
                  {active &&
                    active.status !== "SETTLED" &&
                    !participantView &&
                    !hasReceivedPayment(active) && (
                      <button
                        className="delete-button"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await confirm("Permanently delete this receipt?", {
                              title: "Delete receipt?",
                              confirmLabel: "Delete receipt",
                              danger: true,
                            })
                          )
                            void run(async () => {
                              if (lock.current)
                                throw new Error(
                                  "Please wait for saving to finish.",
                                );
                              if (hasReceivedPayment(active))
                                throw new Error(
                                  "Receipts with received payments cannot be deleted.",
                                );
                              await api.delete(owner!.id, active.id);
                              setDirty(false);
                              setDraft(null);
                              setActive(null);
                              setPage("receipts");
                              await refresh();
                            });
                        }}
                      >
                        <Trash2 size={15} />
                        Delete receipt
                      </button>
                    )}
                </aside>
              </div>
            </>
          )}
        </div>
        <footer>
          SplitShare <span>Created by Thomas Le</span>
          <div className="footer-credit">
            <span>Split and share receipts with your friends!</span>
            <span>Copyright © 2026 Thomas Le. All rights reserved.</span>
          </div>
        </footer>
      </main>
      {identity && (
        <AccountPanel
          close={() => setIdentity(false)}
          beforeSwitch={async () => {
            if (lock.current)
              throw new Error("Please wait for saving to finish.");
            if (
              dirty &&
              !(await confirm("Discard unsaved changes?", {
                title: "Discard changes?",
                confirmLabel: "Discard changes",
                cancelLabel: "Keep editing",
                danger: true,
              }))
            )
              throw new Error("Account change cancelled.");
          }}
        />
      )}
      {scanner && draft && (
        <ReceiptScanner
          currency={draft.currency}
          close={() => setScanner(false)}
          apply={async (result) => {
            const existing = draft.items.filter(
              (i) => i.name.trim() || i.unitPrice > 0,
            );
            const replace =
              existing.length === 0
                ? true
                : await choose(
                    "Replace your existing items or add the scanned items to this receipt?",
                    {
                      title: "Add scanned items",
                      confirmLabel: "Replace items",
                      cancelLabel: "Add to existing items",
                    },
                  );
            if (replace === null) return;
            const scanned = result.items.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              allocations: [],
            }));
            change({
              ...draft,
              merchantName: result.merchant || draft.merchantName,
              purchaseDate: result.date || draft.purchaseDate,
              items: replace ? scanned : [...existing, ...scanned],
              ...(replace
                ? {
                    tax: result.tax,
                    fee: result.fee,
                    tip: result.tip,
                    discount: result.discount,
                    adjustmentAllocations: [],
                  }
                : {}),
            });
            setScanner(false);
          }}
        />
      )}
    </div>
  );
}

