import { t, useLocale } from "../i18n";
export function BrandMark() {
  useLocale();
  return (
    <svg
      className="brand-mark"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={t("Логотип Aether")}
    >
      <path
        d="M12 3 3.8 20 12 15.5 20.2 20 12 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 3v12.5M7.1 13.2h9.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
