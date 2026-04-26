import { describe, expect, it } from "vitest";

import { LIABILITY_COPY, liabilityCopyFor, resolveLiabilityTier } from "../borrow-copy";

describe("resolveLiabilityTier", () => {
  it("returns 'standard' for plain hand-tool tags", () => {
    expect(resolveLiabilityTier(["drill", "household"])).toBe("standard");
  });

  it("returns 'standard' when there are no tags", () => {
    expect(resolveLiabilityTier([])).toBe("standard");
  });

  it("upgrades to 'power-tool' on a sharp/heavy/saw tag", () => {
    expect(resolveLiabilityTier(["saw"])).toBe("power-tool");
    expect(resolveLiabilityTier(["heavy", "drill"])).toBe("power-tool");
    expect(resolveLiabilityTier(["sharp"])).toBe("power-tool");
  });

  it("returns 'high-value' for trailer / log-splitter / 3D printer / CNC", () => {
    expect(resolveLiabilityTier(["trailer"])).toBe("high-value");
    expect(resolveLiabilityTier(["log-splitter"])).toBe("high-value");
    expect(resolveLiabilityTier(["3d-printer"])).toBe("high-value");
    expect(resolveLiabilityTier(["cnc"])).toBe("high-value");
  });

  it("'high-value' wins when both high-value and power-tool tags are present", () => {
    expect(resolveLiabilityTier(["trailer", "heavy"])).toBe("high-value");
  });

  it("is case-insensitive", () => {
    expect(resolveLiabilityTier(["Trailer"])).toBe("high-value");
    expect(resolveLiabilityTier(["SAW"])).toBe("power-tool");
  });
});

describe("liabilityCopyFor", () => {
  it("returns the matching copy block from the registry", () => {
    expect(liabilityCopyFor(["drill"])).toBe(LIABILITY_COPY.standard);
    expect(liabilityCopyFor(["saw"])).toBe(LIABILITY_COPY["power-tool"]);
    expect(liabilityCopyFor(["trailer"])).toBe(LIABILITY_COPY["high-value"]);
  });
});
