import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { GARAGE_ID, OWNER_PHONE, seedGarage, seedItemRecord, seedUser } from "./_fixtures.js";
import { clearNotifierSpy, spyNotifier } from "./_notifier-spy.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

let sent: ReturnType<typeof spyNotifier>;

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  sent = spyNotifier();
  seedGarage();
  seedUser(OWNER_PHONE);
});

afterEach(() => clearNotifierSpy());

function patchStatus(status: string) {
  return createApp().request(`/v1/g/${GARAGE_ID}/items/drill`, {
    method: "PATCH",
    headers: { ...authHeader(OWNER_PHONE), "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

describe("waitlist_unblocked on item status change", () => {
  it("fires when an item comes back into service", async () => {
    seedItemRecord({ id: "drill", status: "maintenance" });
    expect((await patchStatus("available")).status).toBe(200);
    const events = sent.filter((e) => e.type === "waitlist_unblocked");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ garage_id: GARAGE_ID, payload: { item_id: "drill" } });
  });

  it("stays quiet when the item was already lendable or goes out of service", async () => {
    seedItemRecord({ id: "drill", status: "available" });
    expect((await patchStatus("partial_loaned")).status).toBe(200);
    expect((await patchStatus("broken")).status).toBe(200);
    expect(sent.filter((e) => e.type === "waitlist_unblocked")).toHaveLength(0);
  });
});
