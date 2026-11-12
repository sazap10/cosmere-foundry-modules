import { describe, expect, it } from "vitest";
import { fieldMedicineFormula, normaliseDie, parseDC, regrowthFormula, testSucceeded } from "../../src/abilities/healing";

describe("Field Medicine", () => {
  it("adds Medicine ranks only on a success", () => {
    expect(fieldMedicineFormula("1d8", 3, true)).toBe("1d8 + 3");
    expect(fieldMedicineFormula("1d8", 3, false)).toBe("1d8");
    expect(fieldMedicineFormula("1d8", 0, true)).toBe("1d8");
  });

  it("reads the DC and judges the test at the boundary", () => {
    expect(parseDC("Spend 1 focus to make a DC 15 Medicine test")).toBe(15);
    expect(parseDC("No difficulty here")).toBeNull();
    expect(testSucceeded(15, 15)).toBe(true);
    expect(testSucceeded(14, 15)).toBe(false);
    expect(testSucceeded(null, 15)).toBeNull();
  });

  it("normalises the recovery die", () => {
    expect(normaliseDie("d8")).toBe("1d8");
    expect(normaliseDie("1d10")).toBe("1d10");
    expect(normaliseDie("8")).toBeNull();
    expect(normaliseDie(undefined)).toBeNull();
  });
});

describe("Progression (Regrowth)", () => {
  it("grows the die a size per rank from d4, capped at d12", () => {
    expect(regrowthFormula(1, 2)).toBe("1d4 + 2");
    expect(regrowthFormula(2, 3)).toBe("1d6 + 3");
    expect(regrowthFormula(3, 5)).toBe("1d8 + 5");
    expect(regrowthFormula(9, 5)).toBe("1d12 + 5");
    expect(regrowthFormula(0, 0)).toBe("1d4");
  });
});
