import { describe, expect, it } from "vitest";
import { texToText } from "./texToText";

describe("texToText", () => {
  it("converts powers, logs and big-O notation", () => {
    expect(texToText("O(n^2)")).toBe("O(n²)");
    expect(texToText(String.raw`O(n \log n)`)).toBe("O(n log n)");
    expect(texToText(String.raw`\Theta(n^{2})`)).toBe("Θ(n²)");
    expect(texToText("n = 10^2, 10^3, 10^5")).toBe("n = 10², 10³, 10⁵");
  });

  it("converts subscripts, fractions, roots and relations", () => {
    expect(texToText("a_i \\le b_{i+1}")).toBe("aᵢ ≤ bᵢ₊₁");
    expect(texToText(String.raw`\frac{n}{2}`)).toBe("(n)/(2)");
    expect(texToText(String.raw`\sqrt{n}`)).toBe("√n");
    expect(texToText(String.raw`\sqrt{n+1}`)).toBe("√(n+1)");
    expect(texToText(String.raw`n \times m \geq 0`)).toBe("n × m ≥ 0");
  });

  it("falls back to readable text when a script cannot be converted", () => {
    expect(texToText("2^{n+z}")).toBe("2^(n+z)");
    expect(texToText("x_{ab}")).toBe("x_ab");
  });
});
