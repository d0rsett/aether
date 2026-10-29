import type { Locale } from "./index";

export function editorPhrases(locale: Locale): Record<string, string> {
  const shared = {
    "Fold line": locale === "en" ? "Fold section" : "Свернуть раздел",
    "Unfold line": locale === "en" ? "Unfold section" : "Развернуть раздел",
    "folded code": locale === "en" ? "Folded text" : "Свёрнутый текст",
    unfold: locale === "en" ? "Unfold" : "Развернуть",
  };
  return locale === "en"
    ? shared
    : {
        ...shared,
        Find: "Найти",
        Replace: "Заменить",
        next: "Далее",
        previous: "Назад",
        "match case": "Учитывать регистр",
        regexp: "Регулярное выражение",
        "by word": "Слова целиком",
        replace: "Заменить",
        "replace all": "Заменить всё",
        close: "Закрыть",
        "Go to line": "Перейти к строке",
        go: "Перейти",
        "current match": "Текущее совпадение",
        "on line": "в строке",
        "replaced $ matches": "Заменено совпадений: $",
        "replaced match on line $": "Заменено совпадение в строке $",
      };
}
