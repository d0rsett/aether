export const clipboardType = "application/x-aether-canvas";
export function httpUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function snapAxis(
  value: number,
  size: number,
  targets: number[],
  tolerance: number,
) {
  let best = tolerance;
  let snapped = value;
  for (const edge of [value, value + size / 2, value + size]) {
    for (const target of targets) {
      const distance = target - edge;
      if (Math.abs(distance) <= best) {
        best = Math.abs(distance);
        snapped = value + distance;
      }
    }
  }
  return snapped;
}
