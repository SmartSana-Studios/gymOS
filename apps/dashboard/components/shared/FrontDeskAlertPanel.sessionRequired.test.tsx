/**
 * Story 19.9b: the session-required variant of the single front-desk alert
 * panel. Info treatment with label, assertive live region, class / offline /
 * in-flight lines, [Record session payment] and no [Renew]; subscription
 * alerts keep their own variant; a coach gets no record action.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { FrontDeskAlertRow } from "@/services/frontDeskAlerts";

const removeChannel = vi.fn();
let capturedHandler: ((row: Record<string, unknown>) => void) | null = null;
let capturedOptions: unknown;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ removeChannel: (...args: unknown[]) => removeChannel(...args) }),
}));
vi.mock("@/lib/realtime/frontDeskAlerts", () => ({
  autoDismissFrontDeskAlert: vi.fn(async () => ({ error: null })),
  dismissFrontDeskAlert: vi.fn(async () => ({ error: null })),
  fetchActiveFrontDeskAlerts: vi.fn(async () => []),
  resolveMemberDisplay: vi.fn(async () => ({ data: { name: "Late Joiner", photoUrl: null }, error: null })),
  subscribeToFrontDeskAlerts: (
    _gymId: string,
    handler: (row: Record<string, unknown>) => void,
    _onStatus: unknown,
    options: unknown,
  ) => {
    capturedHandler = handler;
    capturedOptions = options;
    return { topic: "channel" };
  },
}));
vi.mock("@/lib/frontDeskSessionAlerts", () => ({
  loadSessionAlertContext: vi.fn(
    async () =>
      new Map([["m-late", { className: null, scannedOfflineAt: null, paymentInFlight: false }]]),
  ),
}));
vi.mock("@/components/shared/RenewalModal", () => ({ RenewalModal: () => <div>renewal-modal</div> }));
vi.mock("@/components/shared/RecordSessionPaymentDialog", () => ({
  RecordSessionPaymentDialog: ({
    memberName,
    alertId,
    onRecorded,
  }: {
    memberName: string;
    alertId?: string;
    onRecorded: () => void;
  }) => (
    <div>
      <p>{`record-panel:${memberName}:${alertId}`}</p>
      <button type="button" onClick={onRecorded}>
        finish-record
      </button>
    </div>
  ),
}));

const TRANSLATIONS: Record<string, string> = {
  "frontDeskAlert.panelLabel": "Front-desk alerts",
  "frontDeskAlert.sessionRequired": "SESSION REQUIRED",
  "frontDeskAlert.sessionNoPaidSession": "No paid session",
  "frontDeskAlert.sessionRecordHint": "Record a payment so they can scan again.",
  "frontDeskAlert.recordSessionPayment": "Record session payment",
  "frontDeskAlert.sessionPaymentInProgress": "Mobile money payment in progress",
  "frontDeskAlert.renew": "Renew",
  "frontDeskAlert.dismiss": "Dismiss alert",
  "frontDeskAlert.unknownMember": "Unknown member",
  "members.status.expired": "Expired",
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "frontDeskAlert.sessionFromClass") return `From class: ${vars?.name}`;
      if (key === "frontDeskAlert.sessionScannedOffline") return `Scanned offline at ${vars?.time}`;
      if (key === "sessionPayment.recordedToast") return `Session recorded for ${vars?.name}. Ask them to scan again.`;
      if (key === "frontDeskAlert.expiredDaysAgo") return `Expired ${vars?.count} days ago`;
      return TRANSLATIONS[key] ?? key;
    },
    i18n: { language: "en" },
  }),
}));

import { FrontDeskAlertPanel } from "./FrontDeskAlertPanel";

const sessionAlert: FrontDeskAlertRow = {
  id: "a1",
  memberId: "m1",
  memberName: "Alice",
  memberPhotoUrl: null,
  kind: "session_required",
  status: null,
  expiryDate: null,
  createdAt: new Date().toISOString(),
  className: "HIIT",
  scannedOfflineAt: "2026-10-11T08:15:00Z",
  paymentInFlight: true,
};
const subscriptionAlert: FrontDeskAlertRow = {
  id: "a2",
  memberId: "m2",
  memberName: "Bob",
  memberPhotoUrl: null,
  kind: "subscription_status",
  status: "expired",
  expiryDate: "2026-10-01",
  createdAt: new Date().toISOString(),
};

function renderPanel(alerts: FrontDeskAlertRow[], role = "receptionist") {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <FrontDeskAlertPanel
        gymId="gym-1"
        initialAlerts={alerts}
        autoDismissMinutes={30}
        mobileMoneyEnabled={false}
        role={role}
      />
    </QueryClientProvider>,
  );
}

describe("FrontDeskAlertPanel session-required variant (Story 19.9b)", () => {
  beforeEach(() => {
    capturedHandler = null;
    capturedOptions = undefined;
  });

  it("renders the session variant: label, assertive live region, lines and no Renew", () => {
    renderPanel([sessionAlert]);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent("SESSION REQUIRED");
    expect(alert).toHaveTextContent("Alice");
    expect(alert).toHaveTextContent("No paid session");
    expect(alert).toHaveTextContent("Record a payment so they can scan again.");
    expect(alert).toHaveTextContent("From class: HIIT");
    expect(alert).toHaveTextContent("Scanned offline at");
    expect(alert).toHaveTextContent("Mobile money payment in progress");
    expect(screen.getByRole("button", { name: "Record session payment" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Renew" })).not.toBeInTheDocument();
  });

  it("keeps a subscription alert on its own variant alongside a session one", () => {
    renderPanel([sessionAlert, subscriptionAlert]);

    expect(screen.getByRole("button", { name: "Renew" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Record session payment" })).toHaveLength(1);
  });

  it("omits the optional lines when the alert has none", () => {
    renderPanel([{ ...sessionAlert, className: null, scannedOfflineAt: null, paymentInFlight: false }]);

    const alert = screen.getByRole("alert");
    expect(alert).not.toHaveTextContent("From class");
    expect(alert).not.toHaveTextContent("Scanned offline");
    expect(alert).not.toHaveTextContent("Mobile money payment in progress");
  });

  it("opens the record panel for the alert, then removes the alert and toasts on success", async () => {
    const user = userEvent.setup();
    renderPanel([sessionAlert]);

    await user.click(screen.getByRole("button", { name: "Record session payment" }));
    expect(screen.getByText("record-panel:Alice:a1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "finish-record" }));

    await waitFor(() => expect(screen.queryByText("record-panel:Alice:a1")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Session recorded for Alice. Ask them to scan again.");
    expect(screen.queryByText("SESSION REQUIRED")).not.toBeInTheDocument();
  });

  it("shows no record action to a coach", () => {
    renderPanel([sessionAlert], "coach");

    expect(screen.queryByRole("button", { name: "Record session payment" })).not.toBeInTheDocument();
  });

  it("subscribes with session alerts included and renders a realtime session insert", async () => {
    renderPanel([]);
    expect(capturedOptions).toEqual({ includeSessionRequired: true });

    capturedHandler?.({
      id: "a9",
      member_id: "m-late",
      kind: "session_required",
      status: null,
      expiry_date: null,
      created_at: new Date().toISOString(),
      dismissed_at: null,
    });

    expect(await screen.findByText("SESSION REQUIRED")).toBeInTheDocument();
    expect(screen.getByText("Late Joiner")).toBeInTheDocument();
  });
});
