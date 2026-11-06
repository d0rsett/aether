import { t } from "../i18n";

export function attachmentBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () =>
      reject(new Error(t`Не удалось прочитать ${file.name}`));
    reader.readAsDataURL(file);
  });
}
