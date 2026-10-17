// Client-side hints only; the API enforces the same rules (backend/utils/validators.py).
export const PASSWORD_RULES: Array<{ id: string; label: string; test: (value: string) => boolean }> = [
  { id: "length", label: "At least 8 characters", test: (value) => value.length >= 8 && value.length <= 128 },
  { id: "upper", label: "An uppercase letter", test: (value) => /[A-Z]/.test(value) },
  { id: "lower", label: "A lowercase letter", test: (value) => /[a-z]/.test(value) },
  { id: "digit", label: "A number", test: (value) => /\d/.test(value) },
  { id: "special", label: "A special character", test: (value) => /[!@#$%^&*()_+\-=[\]{};:'",.<>?/\\|`~]/.test(value) },
];

export const unmetPasswordRules = (value: string) => PASSWORD_RULES.filter((rule) => !rule.test(value));
