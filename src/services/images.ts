export const imageDragType = "application/x-aether-image";
export function imageExtension(path: string): string | null {
  return (
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.exec(path)?.[1].toUpperCase() ?? null
  );
}
