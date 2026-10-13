import { session, type Account, type Credentials } from "./session";
export type User = Account;
export type Friend = {
  id: number;
  userId: number;
  displayName: string;
  email: string | null;
  status: string;
};
export type Method = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
export type Allocation = {
  userId: number;
  allocationType: Method;
  inputValue: number;
};
export type Item = {
  name: string;
  quantity: number;
  unitPrice: number;
  allocations: Allocation[];
};
export type Adjustment = {
  adjustmentType: "TAX" | "FEE" | "TIP";
  userId: number;
  amount: number;
};
export type Draft = {
  merchantName: string;
  purchaseDate: string;
  currency: string;
  discount: number;
  tax: number;
  fee: number;
  tip: number;
  participantUserIds: number[];
  items: Item[];
  adjustmentAllocations: Adjustment[];
};
export type Receipt = Omit<Draft, "items" | "participantUserIds"> & {
  id: number;
  ownerId: number;
  total: number;
  subtotal: number;
  status: "DRAFT" | "FINALIZED" | "SETTLED";
  participants: { id: number; userId: number; finalOwedAmount: number }[];
  items: (Omit<Item, "allocations"> & {
    id: number;
    total: number;
    allocations: {
      participantId: number;
      allocationType: Method;
      inputValue: number;
      finalAmount: number;
    }[];
  })[];
};
export type Split = {
  total: number;
  participants: {
    participantId: number;
    userId: number;
    username: string;
    finalOwedAmount: number;
  }[];
  allocations: {
    itemName: string;
    participantId: number;
    finalAmount: number;
  }[];
};
export class ApiError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
    public status?: number,
  ) {
    super(message);
  }
}
// The same-origin gateway keeps persistent refresh credentials out of JavaScript.
const base = "";
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  protectedCall = true,
  retry = true,
): Promise<T> {
  const epoch = session.epoch();
  if (protectedCall && session.expired()) await refreshSession();
  if (protectedCall && epoch !== session.epoch())
    throw new DOMException("Session changed", "AbortError");
  let response: Response;
  const sentToken = protectedCall ? session.token() : undefined;
  try {
    response = await fetch(`${base}/api${path}`, {
      method,
      credentials: "same-origin",
      signal: session.signal(),
      headers: {
        "X-SplitShare-Request": "1",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError(
      "Cannot reach the server. Check your connection and try again.",
    );
  }
  if (epoch !== session.epoch())
    throw new DOMException("Session changed", "AbortError");
  if (response.status === 401 && protectedCall && retry) {
    if (sentToken === session.token()) await refreshSession();
    if (epoch !== session.epoch())
      throw new DOMException("Session changed", "AbortError");
    return request<T>(path, method, body, true, false);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const fallback: Record<number, string> = {
      401: "Please sign in again.",
      403: "You no longer have access to this receipt.",
      429: `Too many attempts. Wait ${response.headers.get("Retry-After") || "60"} seconds before retrying.`,
      503: "This service is unavailable. Please try again later.",
    };
    if (response.status === 401 && protectedCall) session.set(null);
    throw new ApiError(
      data.message ||
        fallback[response.status] ||
        `Request failed (${response.status})`,
      data.fieldErrors || {},
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
function refreshSession() {
  return session.refresh((token) =>
    request<Credentials>(
      "/auth/refresh",
      "POST",
      token === "cookie" ? undefined : { refreshToken: token },
      false,
    ),
  );
}
export const auth = {
  restore: () =>
    request<Credentials | undefined>("/session", "GET", undefined, false),
  guest: () => request<Credentials>("/auth/guest", "POST", undefined, false),
  login: (body: unknown) =>
    request<Credentials>("/auth/login", "POST", body, false),
  register: (body: unknown) =>
    request<Credentials>("/auth/register", "POST", body, !!session.get()),
  me: () => request<Account>("/auth/me"),
  profile: (displayName: string) =>
    request<Account>("/auth/me", "PUT", { displayName }),
  logout: (all = false) =>
    request<void>(all ? "/auth/logout-all" : "/auth/logout", "POST"),
  deactivate: () => request<void>("/auth/me", "DELETE"),
  changePassword: (body: unknown) =>
    request<void>("/auth/password/change", "POST", body),
  sendVerification: () =>
    request<void>("/auth/email/send-verification", "POST"),
  verify: (token: string) =>
    request<void>("/auth/email/verify", "POST", { token }, false),
  forgot: (email: string) =>
    request<void>("/auth/password/forgot", "POST", { email }, false),
  reset: (body: unknown) =>
    request<void>("/auth/password/reset", "POST", body, false),
  nonce: (linkAccount = false) =>
    request<{ nonce: string }>(
      "/auth/google/nonce",
      "POST",
      undefined,
      linkAccount,
    ),
  google: (idToken: string, nonce: string, linkAccount = false) =>
    request<Credentials>(
      "/auth/google",
      "POST",
      { idToken, nonce },
      linkAccount,
    ),
};
const receiptPath = (owner: number, id?: number, action = "") =>
  `/receipts${id ? `/${id}` : ""}${action ? `/${action}` : ""}?userId=${owner}`;
export const remoteApi = {
  friends: (id: number) => request<Friend[]>(`/users/${id}/friends`),
  addFriend: (id: number, displayName: string, email?: string) =>
    request<Friend>(`/users/${id}/friends`, "POST", {
      displayName,
      ...(email ? { email } : {}),
    }),
  removeFriend: (id: number, friend: number) =>
    request<void>(`/users/${id}/friends/${friend}`, "DELETE"),
  list: (owner: number) => request<Receipt[]>(receiptPath(owner)),
  get: (owner: number, id: number) => request<Receipt>(receiptPath(owner, id)),
  save: (owner: number, id: number, draft: Draft) =>
    request<Receipt>(receiptPath(owner, id, "draft"), "PUT", {
      ...draft,
      participantUserIds: draft.participantUserIds.filter((id) => id !== owner),
      items: draft.items.map((i) => ({
        ...i,
        allocations: i.allocations.filter((a) => a.inputValue > 0),
      })),
    }),
  create: (owner: number, draft: Draft) => {
    const subtotal = draft.items.reduce(
      (n, i) => n + i.quantity * i.unitPrice,
      0,
    );
    return request<Receipt>(receiptPath(owner), "POST", {
      merchantName: draft.merchantName,
      purchaseDate: draft.purchaseDate,
      currency: draft.currency,
      discount: draft.discount,
      tax: draft.tax,
      fee: draft.fee,
      tip: draft.tip,
      total: subtotal - draft.discount + draft.tax + draft.fee + draft.tip,
      items: draft.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.quantity * i.unitPrice,
      })),
    });
  },
  action: <T>(owner: number, id: number, action: string) =>
    request<T>(receiptPath(owner, id, action), "POST"),
  delete: (owner: number, id: number) =>
    request<void>(receiptPath(owner, id), "DELETE"),
};
export function toDraft(r: Receipt): Draft {
  return {
    merchantName: r.merchantName || "",
    purchaseDate: r.purchaseDate || "",
    currency: r.currency,
    discount: r.discount,
    tax: r.tax,
    fee: r.fee,
    tip: r.tip,
    participantUserIds: r.participants.map((p) => p.userId),
    adjustmentAllocations: (r.adjustmentAllocations || []).map((a) => ({
      adjustmentType: a.adjustmentType,
      userId: a.userId,
      amount: a.amount,
    })),
    items: r.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      allocations: i.allocations.map((a) => ({
        userId: r.participants.find((p) => p.id === a.participantId)!.userId,
        allocationType: a.allocationType,
        inputValue: a.inputValue,
      })),
    })),
  };
}
export const money = (value: number, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
};

export const api = remoteApi;
