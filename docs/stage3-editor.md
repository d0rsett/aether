# Редактор: контракт и ограничения

## Данные и рендеринг

`render_markdown(vaultId,path,content) -> {nodes,warning}` проверяет активный vault и путь, затем в blocking runtime разбирает текущий буфер через pulldown-cmark с CommonMark/GFM/wiki/math extensions. YAML и BOM отделяет общий модуль markdown. Результат — инертное дерево разрешённых узлов и диапазонов строк. React создаёт заголовки, списки, таблицы, ссылки, цитаты и код; raw HTML отображается текстом. Файл на диске не изменяется. Ограничения Reading Mode: 4 МБ, 100 000 событий и глубина 64; Source Mode остаётся доступен при превышении.

В Reading Mode только активная вкладка вызывает рендерер; запрос отложен на 80 мс, старые ответы отбрасываются. Скрытые редакторы сохраняют CodeMirror state. Текстовый Live Preview использует Lezer и decorations видимого диапазона. Сложные блоки отображаются через StateField/block widgets, inline math/images — через inline widgets; разбор отложен на 160 мс после правки. Затронутый блок/строка раскрываются в исходный Markdown. Новые UTF-16 диапазоны учитывают BOM/emoji/CRLF. Подробности и ограничения вложенных блоков — в [live-blocks.md](live-blocks.md). Это не полная совместимость Live Preview Obsidian.

## Вложения и переходы

`read_image(vaultId,source,target,wiki)` разрешает относительный путь в Rust, включая percent-encoding и `../` без выхода из vault. Wiki-изображение сначала проверяет точный путь от корня, затем соседний путь; явные `./`/`../` остаются относительными. Глобальный поиск картинок по basename не выполняется. `.aether`, ADS, абсолютные пути, URL, symlink/junction запрещены Vault resolver. PNG/JPEG/GIF/WebP определяются по сигнатуре, размер ограничен 8 МБ. Файл возвращается как data URL; IntersectionObserver откладывает чтение до приближения к видимой области. SVG и внешние картинки не исполняются/не загружаются.

`document_link` нормализует Markdown-ссылку относительно исходной заметки, сохраняя anchor; переход использует существующий wiki/navigation API. `open_external` принимает только разобранные http/https URL с host, без управляющих символов. На Windows URL передаётся напрямую ShellExecuteW, на macOS/Linux — отдельным argv open/xdg-open, без shell-строки. Переход возникает только по щелчку, не при рендеринге. Внешний браузер в автоматических тестах не запускается.

## Формулы и диаграммы

KaTeX загружается при наличии формулы/диаграммы; `trust:false`, ограничены размер и macro expansion. HTML создаётся собственным `renderToString` библиотеки, не из raw HTML заметки. Новый macros scope создаётся для каждого рендера. См. [опции KaTeX](https://katex.org/docs/options).

Mermaid загружается только при наличии fenced-блока. Включены strict security, отключён автоматический запуск; конфигурационные frontmatter/directives внутри диаграммы запрещены. Лимиты: 20 000 символов и 300 рёбер. SVG показывается в iframe с пустым `sandbox`, без scripts/same-origin/top-navigation, с отдельным CSP, запрещающим сеть и формы. Не вызывается bindFunctions. Основной CSP разрешает собственный frame, не внешние сайты. См. [securityLevel](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html) и [secure keys](https://mermaid.js.org/config/schema-docs/config-properties-secure.html). Ошибка диаграммы показывает код и сообщение; остальная заметка доступна.

Новые зависимости обоснованы функциями: Mermaid — диаграммы, KaTeX — математика, CodeMirror autocomplete — подсказки; base64 — ограниченные растровые вложения через IPC; windows-sys — открытие проверенного URL без shell. Версии закреплены lock-файлами. Большие библиотеки и шрифты находятся в lazy chunks; numeric FPS/RAM не измерены.

## Редактирование

Панель и Ctrl+B / Ctrl+I вызывают изменения CodeMirror с userEvent input, сохраняя Undo и line separator. Подсказки `[[…` используют поиск по индексу (до 50 результатов); после `#` — до 100 заголовков и 32 проверенных кандидатов block ID. Для текущей заметки используется актуальный CodeMirror buffer, для остальных — сохранённый файл. При недоступном индексе подсказки скрываются, редактирование работает. В кодовых блоках/inline code подсказки не предлагаются.

Не реализованы inline-transclusion заметок, редактирование таблиц мышью и специальные визуальные редакторы формул/диаграмм. Чекбоксы в Reading Mode доступны только для просмотра. Raw HTML не преобразуется в пользовательские HTML-компоненты.
