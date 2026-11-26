import { t, useLocale } from "../i18n";
export function BrandMark() {
  useLocale();
  return (
    <svg
      className="brand-mark"
      width="20"
      height="20"
      viewBox="0 0 128 128"
      fill="none"
      role="img"
      aria-label={t("Логотип Aether")}
    >
      <path
        d="m26 43 36 19 27-35M62 62l35 27M62 62 38 99M26 43l12 56"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill="currentColor">
        <circle cx="26" cy="43" r="10" />
        <circle cx="62" cy="62" r="14" />
        <circle cx="89" cy="27" r="10" />
        <circle cx="97" cy="89" r="11" />
        <circle cx="38" cy="99" r="9" />
      </g>
    </svg>
  );
}
