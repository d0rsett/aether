export interface Typography {
  fontSize: number;
  lineHeight: number;
  textWidth: number;
}
export const defaultTypography: Typography = {
  fontSize: 15,
  lineHeight: 1.85,
  textWidth: 788,
};
export const typographyKey = "aether.ui.typography";
export function parseTypography(raw: string | null): Typography {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return { ...defaultTypography };
    const field = (key: keyof Typography, min: number, max: number) => {
      const number = Reflect.get(value, key);
      return typeof number === "number" &&
        Number.isFinite(number) &&
        number >= min &&
        number <= max
        ? number
        : defaultTypography[key];
    };
    return {
      fontSize: field("fontSize", 12, 24),
      lineHeight: field("lineHeight", 1.2, 2.4),
      textWidth: field("textWidth", 480, 1100),
    };
  } catch {
    return { ...defaultTypography };
  }
}
export function readTypography(): Typography {
  try {
    return parseTypography(localStorage.getItem(typographyKey));
  } catch {
    return { ...defaultTypography };
  }
}
