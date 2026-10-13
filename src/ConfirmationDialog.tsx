import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

type Options = {
  title: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type Request = Options & {
  message: string;
  mode: "confirm" | "choice" | "notice";
  resolve: (result: boolean | null) => void;
};
type Dialogs = {
  isOpen: boolean;
  confirm: (message: string, options: Options) => Promise<boolean>;
  choose: (message: string, options: Options) => Promise<boolean | null>;
  notify: (message: string, options: Options) => Promise<void>;
};
const Context = createContext<Dialogs | null>(null);

export function useConfirmation() {
  const dialogs = useContext(Context);
  if (!dialogs) throw new Error("ConfirmationProvider is required.");
  return dialogs;
}

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target !== document.body &&
        !event.target.closest(".confirmation-dialog")
      ) {
        lastFocused.current = event.target;
      }
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, []);
  const enqueue = useCallback(
    (message: string, options: Options, mode: Request["mode"]) =>
      new Promise<boolean | null>((resolve) => {
        const next = { ...options, message, mode, resolve };
        pending.current.push(next);
        if (pending.current.length === 1) setRequest(next);
      }),
    [],
  );
  const finish = useCallback((result: boolean | null) => {
    dialog.current?.close();
    const current = pending.current.shift();
    setRequest(pending.current[0] ?? null);
    current?.resolve(result);
  }, []);

  useEffect(() => {
    if (!request || !dialog.current) return;
    const previous =
      document.activeElement === document.body
        ? lastFocused.current
        : document.activeElement;
    dialog.current.showModal();
    dialog.current
      .querySelector<HTMLButtonElement>("[data-initial-focus]")
      ?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      requestAnimationFrame(() => {
        if (
          !pending.current.length &&
          previous instanceof HTMLElement &&
          previous.isConnected
        )
          previous.focus();
      });
    };
  }, [request]);
  useEffect(
    () => () => {
      pending.current.splice(0).forEach((item) => item.resolve(null));
    },
    [],
  );

  const dialogs: Dialogs = {
    isOpen: request !== null,
    confirm: async (message, options) =>
      (await enqueue(message, options, "confirm")) === true,
    choose: (message, options) => enqueue(message, options, "choice"),
    notify: async (message, options) => {
      await enqueue(message, options, "notice");
    },
  };
  return (
    <Context.Provider value={dialogs}>
      {children}
      {request &&
        createPortal(
          <dialog
            ref={dialog}
            className="confirmation-dialog"
            aria-modal="true"
            aria-labelledby="confirmation-title"
            aria-describedby="confirmation-message"
            onCancel={(event) => {
              event.preventDefault();
              finish(null);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key !== "Tab") return;
              const controls = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              ];
              const first = controls[0];
              const last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <button
              type="button"
              className="confirmation-close"
              aria-label="Close confirmation"
              onClick={() => finish(null)}
            >
              <X size={20} />
            </button>
            <span
              className={`confirmation-icon${request.danger ? " danger" : ""}`}
              aria-hidden="true"
            >
              {request.mode === "notice" ? (
                <CheckCircle2 size={24} />
              ) : (
                <AlertTriangle size={24} />
              )}
            </span>
            <h2 id="confirmation-title">{request.title}</h2>
            <p id="confirmation-message">{request.message}</p>
            <div className="confirmation-actions">
              {request.mode !== "notice" && (
                <button
                  type="button"
                  data-initial-focus
                  onClick={() => finish(false)}
                >
                  {request.cancelLabel ?? "Cancel"}
                </button>
              )}
              <button
                type="button"
                data-initial-focus={
                  request.mode === "notice" ? true : undefined
                }
                className={`primary${request.danger ? " confirmation-danger" : ""}`}
                onClick={() => finish(true)}
              >
                {request.confirmLabel ??
                  (request.mode === "notice" ? "Got it" : "Continue")}
              </button>
            </div>
          </dialog>,
          document.body,
        )}
    </Context.Provider>
  );
}
