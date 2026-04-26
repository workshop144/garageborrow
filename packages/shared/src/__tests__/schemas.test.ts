import { describe, expect, it } from "vitest";

import {
  AiInteractionSchema,
  DonationOfferSchema,
  GarageMembershipSchema,
  GarageSchema,
  IncidentReportSchema,
  InstanceSchema,
  ItemSchema,
  LoanSchema,
  NonprofitOrgSchema,
  NotificationSchema,
  PushSubscriptionSchema,
  ReservationSchema,
  UserSchema,
  WaitlistEntrySchema,
} from "../schemas/index.js";

const PHONE = "+15551234567";
const NOW = "2026-04-25T12:00:00Z";
const LATER = "2026-04-28T12:00:00Z";
const DATE = "2026-04-25";

function pathOf(err: unknown): (string | number)[] {
  if (
    err &&
    typeof err === "object" &&
    "issues" in err &&
    Array.isArray((err as { issues: unknown[] }).issues)
  ) {
    return (err as { issues: { path: (string | number)[] }[] }).issues[0]!.path;
  }
  return [];
}

describe("NonprofitOrgSchema", () => {
  it("accepts valid", () => {
    const r = NonprofitOrgSchema.safeParse({
      name: "Example Community Foundation",
      display_order: 0,
    });
    expect(r.success).toBe(true);
  });
  it("rejects negative display_order", () => {
    const r = NonprofitOrgSchema.safeParse({ name: "x", display_order: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["display_order"]);
  });
});

describe("GarageSchema", () => {
  const valid = {
    id: "demo-garage",
    name: "Demo Garage",
    owner_phone: PHONE,
    city_slug: "sample-town",
    city_display: "Sample Town, ST",
    geo: { lat: 39.8283, lon: -98.5795 },
    quality_tiers: ["Pro", "Standard", "Basic", "Beat-up"],
    status: "open" as const,
    created_at: NOW,
    updated_at: NOW,
  };
  it("accepts valid (with defaults filled in)", () => {
    const r = GarageSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ai_enabled).toBe(false);
      expect(r.data.ai_min_tier).toBe("family");
      expect(r.data.ai_default_model).toBe("haiku");
      expect(r.data.tier_labels).toEqual({
        howdy: "Howdy",
        friend: "Friend",
        family: "Family",
      });
      expect(r.data.vouching_required).toBe(false);
    }
  });
  it("rejects non-E.164 phone", () => {
    const r = GarageSchema.safeParse({ ...valid, owner_phone: "555-1234" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["owner_phone"]);
  });
});

describe("UserSchema", () => {
  const valid = {
    phone: PHONE,
    display_name: "Mr. Broots",
    notification_prefs: {},
    created_at: NOW,
    last_seen_at: NOW,
  };
  it("accepts valid (with prefs defaults)", () => {
    const r = UserSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.visibility).toBe("visible");
      expect(r.data.notification_prefs.sms_enabled).toBe(true);
      expect(r.data.notification_prefs.quiet_hours_start).toBe("21:00");
    }
  });
  it("rejects bad phone", () => {
    const r = UserSchema.safeParse({ ...valid, phone: "not-a-phone" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["phone"]);
  });
});

describe("GarageMembershipSchema", () => {
  const valid = {
    garage_id: "demo-garage",
    user_phone: PHONE,
    joined_at: NOW,
  };
  it("accepts valid (defaults to howdy)", () => {
    const r = GarageMembershipSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tier).toBe("howdy");
      expect(r.data.borrows_total).toBe(0);
    }
  });
  it("rejects unknown tier", () => {
    const r = GarageMembershipSchema.safeParse({ ...valid, tier: "founder" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["tier"]);
  });
});

describe("ItemSchema", () => {
  const valid = {
    id: "item_drill",
    garage_id: "demo-garage",
    name: "Cordless drill",
    description: "18V Ryobi cordless drill",
    category: "power-tools",
    primary_photo_key: "items/drill/main.jpg",
    status: "available" as const,
    created_at: NOW,
    updated_at: NOW,
  };
  it("accepts valid (defaults set)", () => {
    const r = ItemSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.default_duration_days).toBe(3);
      expect(r.data.requires_approval).toBe(false);
      expect(r.data.min_tier).toBe("howdy");
      expect(r.data.auto_approve_tier).toBe("family");
    }
  });
  it("rejects unknown status", () => {
    const r = ItemSchema.safeParse({ ...valid, status: "exploded" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["status"]);
  });
});

describe("InstanceSchema", () => {
  const valid = {
    id: "inst_1",
    item_id: "item_drill",
    garage_id: "demo-garage",
    label: "Drill A",
    quality_tier: "Pro",
    status: "available" as const,
    created_at: NOW,
    updated_at: NOW,
  };
  it("accepts valid", () => {
    expect(InstanceSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects unknown status", () => {
    const r = InstanceSchema.safeParse({ ...valid, status: "haunted" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["status"]);
  });
});

describe("LoanSchema", () => {
  const valid = {
    id: "loan_1",
    garage_id: "demo-garage",
    item_id: "item_drill",
    borrower_phone: PHONE,
    borrowed_at: NOW,
    expected_return_at: LATER,
    status: "active" as const,
    liability_acknowledged_at: NOW,
    liability_copy_version: "v1.0.0",
  };
  it("accepts valid", () => {
    const r = LoanSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.extension_count).toBe(0);
  });
  it("rejects unknown status", () => {
    const r = LoanSchema.safeParse({ ...valid, status: "in-orbit" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["status"]);
  });
});

describe("ReservationSchema", () => {
  const valid = {
    id: "res_1",
    garage_id: "demo-garage",
    item_id: "item_drill",
    borrower_phone: PHONE,
    start_at: NOW,
    end_at: LATER,
    status: "pending" as const,
    approval_required: true,
  };
  it("accepts valid", () => {
    expect(ReservationSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects unknown status", () => {
    const r = ReservationSchema.safeParse({ ...valid, status: "denied" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["status"]);
  });
});

describe("WaitlistEntrySchema", () => {
  const valid = {
    id: "wait_1",
    garage_id: "demo-garage",
    item_id: "item_drill",
    borrower_phone: PHONE,
    joined_at: NOW,
    position: 0,
  };
  it("accepts valid (notify default true)", () => {
    const r = WaitlistEntrySchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.notify_when_available).toBe(true);
  });
  it("rejects negative position", () => {
    const r = WaitlistEntrySchema.safeParse({ ...valid, position: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["position"]);
  });
});

describe("DonationOfferSchema", () => {
  const valid = {
    id: "don_1",
    garage_id: "demo-garage",
    donor_phone: PHONE,
    item_name: "Air compressor",
    description: "Old but works",
    condition: "good" as const,
    status: "pending" as const,
    created_at: NOW,
  };
  it("accepts valid (photo_keys default [])", () => {
    const r = DonationOfferSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.photo_keys).toEqual([]);
  });
  it("rejects bad condition", () => {
    const r = DonationOfferSchema.safeParse({ ...valid, condition: "ugly" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["condition"]);
  });
});

describe("IncidentReportSchema", () => {
  const valid = {
    id: "inc_1",
    garage_id: "demo-garage",
    item_id: "item_drill",
    loan_id: "loan_1",
    reporter_phone: PHONE,
    type: "damage" as const,
    description: "Chuck slipped",
    status: "open" as const,
    created_at: NOW,
  };
  it("accepts valid", () => {
    expect(IncidentReportSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects bad type", () => {
    const r = IncidentReportSchema.safeParse({ ...valid, type: "stolen" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["type"]);
  });
});

describe("NotificationSchema", () => {
  const valid = {
    id: "notif_1",
    user_phone: PHONE,
    type: "loan_due_soon",
    payload: { loan_id: "loan_1" },
    channel: "sms" as const,
    sent_at: NOW,
  };
  it("accepts valid", () => {
    expect(NotificationSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects bad channel", () => {
    const r = NotificationSchema.safeParse({ ...valid, channel: "fax" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["channel"]);
  });
});

describe("PushSubscriptionSchema", () => {
  const valid = {
    user_phone: PHONE,
    endpoint: "https://fcm.googleapis.com/fcm/send/abcdef",
    keys: { p256dh: "p256dh_value", auth: "auth_value" },
    created_at: NOW,
  };
  it("accepts valid", () => {
    expect(PushSubscriptionSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects non-URL endpoint", () => {
    const r = PushSubscriptionSchema.safeParse({ ...valid, endpoint: "nope" });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["endpoint"]);
  });
});

describe("AiInteractionSchema", () => {
  const valid = {
    id: "ai_1",
    garage_id: "demo-garage",
    user_phone: PHONE,
    timestamp: NOW,
    model: "haiku" as const,
    prompt_tokens: 100,
    completion_tokens: 50,
    cost_cents: 1,
    prompt_first_200: "What drill should I borrow?",
  };
  it("accepts valid", () => {
    expect(AiInteractionSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects prompt_first_200 over 200 chars", () => {
    const r = AiInteractionSchema.safeParse({
      ...valid,
      prompt_first_200: "a".repeat(201),
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(pathOf(r.error)).toEqual(["prompt_first_200"]);
  });
});

// `DATE` is exercised in a sanity check below — keeps the import surface honest.
describe("date constant sanity", () => {
  it("DATE matches YYYY-MM-DD", () => {
    expect(DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
