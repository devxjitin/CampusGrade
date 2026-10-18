/**
 * Turns the LaTeX that AI tools put between `$...$` into readable Unicode text
 * (`O(n^2)` -> `O(n²)`, `\Theta(n \log n)` -> `Θ(n log n)`). It covers the
 * notation common in programming and algorithms coursework; it is not a TeX engine.
 */
const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", k: "ᵏ", m: "ᵐ", x: "ˣ", t: "ᵗ",
};
const SUBSCRIPT: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", i: "ᵢ", j: "ⱼ", k: "ₖ", n: "ₙ", m: "ₘ", x: "ₓ",
};
const SYMBOLS: Record<string, string> = {
  Theta: "Θ", Omega: "Ω", Delta: "Δ", Sigma: "Σ", Pi: "Π", alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", omega: "ω", phi: "φ",
  times: "×", cdot: "·", div: "÷", pm: "±", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈",
  infty: "∞", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", in: "∈", notin: "∉", sum: "∑", prod: "∏",
  lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", ldots: "…", dots: "…", cdots: "…", quad: " ", qquad: "  ",
  log: "log", ln: "ln", lg: "lg", sin: "sin", cos: "cos", tan: "tan", max: "max", min: "min", gcd: "gcd", mod: "mod",
};

const script = (text: string, map: Record<string, string>, marker: string) => {
  const chars = [...text];
  if (chars.every((char) => map[char])) return chars.map((char) => map[char]).join("");
  return /^\w+$/.test(text) ? `${marker}${text}` : `${marker}(${text})`;
};

export const texToText = (tex: string): string => {
  let out = tex;
  // Commands that wrap text: keep the content.
  out = out.replace(/\\(?:text|mathrm|mathbf|mathit|mathcal|operatorname)\s*\{([^{}]*)\}/g, "$1");
  out = out.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
  out = out.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, inner: string) => (inner.length === 1 ? `√${inner}` : `√(${inner})`));
  out = out.replace(/\\sqrt\s*([A-Za-z0-9])/g, "√$1");
  out = out.replace(/\\([A-Za-z]+)/g, (_m, name: string) => SYMBOLS[name] ?? name);
  out = out.replace(/\\[,;: !]/g, " ");
  out = out.replace(/\^\s*\{([^{}]*)\}/g, (_m, inner: string) => script(inner, SUPERSCRIPT, "^"));
  out = out.replace(/\^\s*([A-Za-z0-9+-])/g, (_m, char: string) => script(char, SUPERSCRIPT, "^"));
  out = out.replace(/_\s*\{([^{}]*)\}/g, (_m, inner: string) => script(inner, SUBSCRIPT, "_"));
  out = out.replace(/_\s*([A-Za-z0-9])/g, (_m, char: string) => script(char, SUBSCRIPT, "_"));
  return out.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
};
