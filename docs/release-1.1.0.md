# Aether 1.1.0

Группы вкладок и разделение редактора для работы с несколькими заметками рядом.

## Изменения

- Перетаскивание вкладки на левую или правую половину редактора создаёт две группы. Между ними можно переносить заметки, изображения, доски Canvas и граф, задавая порядок в каждой полосе.
- Панели имеют независимые выбранные вкладки и режимы просмотра. Разделитель меняет ширину мышью и стрелками; двойной щелчок возвращает 50/50. Пустая группа сворачивается, а объединение сохраняет все открытые документы.
- Команда «Открыть во второй панели» показывает одну Markdown-заметку в двух представлениях. Черновик и undo/redo общие, курсор, прокрутка и режим независимы. Закрытие одного представления сохраняет черновик во втором.
- Сессия хранилища восстанавливает группы, порядок, выбранные файлы, фокус, ширину и резервные черновики. Перенос вкладок сохраняет смонтированные редакторы.
- Активная группа отмечена акцентной линией. Стрелки, Home и End переключают вкладки внутри группы, Alt+Shift+←/→ меняет порядок. Удержание перетаскиваемой вкладки у края автоматически прокручивает полосу.
- Подсветка показывает допустимые цели переноса и очищается при отмене. Команды свойств адресуются исходной панели, а граф получает фокус при навигации с клавиатуры.

## Проверки

Локально прошли 207 frontend-тестов, production-сборка интерфейса, обычная Windows-сборка, проверка форматирования и состава репозитория. Шесть целевых нативных сценариев Windows охватили группы вкладок, общие черновики и undo/redo, независимые режимы, восстановление после перезапуска, свойства заметок, фокус графа и Mermaid. Светлая и тёмная раскладки просмотрены визуально, включая узкое окно.

Полный нативный набор и ручная проверка macOS не выполнялись. Linux не проверен.

## Загрузки

- Windows x64: установщик NSIS. Требуется Microsoft Edge WebView2 Runtime.
- macOS universal: DMG и архив приложения для Apple Silicon и Intel.
- SHA256SUMS.txt содержит контрольные суммы загрузок.

Сборки не подписаны; macOS не нотарифицирована. Автообновление не настроено.

---

Aether 1.1.0 adds two editor tab groups. Drag tabs onto either half to split the workspace, move notes, images, Canvas boards and the graph between strips, resize the panes or merge them. Opening a Markdown note in the second pane shares its draft and undo history while preserving independent cursors, scrolling and modes. Vault sessions restore groups, tab order, selected files, focus, width and recovery drafts.

Arrow keys, Home and End switch tabs within a group; Alt+Shift+Left/Right reorders them. Drag-edge scrolling continues while the pointer stays near an edge. Focus indicators and valid-drop highlights clarify navigation. Double-clicking the separator restores equal widths. Property commands target the originating pane, and keyboard navigation focuses the graph's group.

Local validation passed 207 frontend tests, the production frontend build, an ordinary Windows build, formatting and repository checks. Six targeted Windows native scenarios covered groups, shared drafts and undo/redo, independent modes, restart restoration, properties, graph focus and Mermaid. Light and dark layouts were visually reviewed, including a narrow window. The complete native suite and manual macOS acceptance were not run; Linux remains unvalidated.

Windows requires Microsoft Edge WebView2 Runtime. Downloads are unsigned; macOS is not notarized. Automatic updates are not configured. SHA256SUMS.txt lists download checksums.
