# Aether 1.0.2

Обновление отображения диаграмм Mermaid в Live Preview и режиме чтения.

## Изменения

- Диаграммы вписываются по ширине заметки с сохранением пропорций и показываются целиком без внутренней прокрутки.
- Убраны рамка и отдельный фон диаграммы. Прозрачный фон работает в светлой и тёмной темах.
- Цвета блоков, стрелок и подписей блок-схем согласованы с палитрой приложения и обновляются при её смене. Прямоугольные блоки получили скруглённые углы.
- Сохранены изоляция диаграмм, ограничения содержимого и запрет настроек Mermaid внутри заметки.

## Проверки

Локально прошли 189 frontend-тестов, production-сборка интерфейса, проверка форматирования и состава репозитория. Два целевых нативных сценария Windows прошли на отдельной тестовой сборке 1.0.2: режим чтения с Mermaid и Live Preview с переключением темы, редактированием и отменой изменений. Проверены пропорции, отсутствие внутренней прокрутки и обновление цветов. Снимок диаграммы в режиме чтения просмотрен визуально.

Полный нативный набор и ручная проверка macOS не выполнялись. Linux не проверен.

## Загрузки и ограничения

- Windows x64: установщик NSIS. Требуется Microsoft Edge WebView2 Runtime.
- macOS universal: DMG и архив приложения для Apple Silicon и Intel.
- SHA256SUMS.txt содержит контрольные суммы загрузок.

Сборки не подписаны; macOS не нотарифицирована. Автообновление не настроено.

---

Mermaid diagrams now fit the note width with their original proportions and no internal scrolling in Live Preview and Reading mode. Frames and opaque backgrounds are removed in both themes. Flowchart nodes, connectors and labels follow the application palette and update when it changes. Diagram sandboxing and content restrictions remain in place.

All 189 frontend tests, the production frontend build, formatting and repository checks passed locally. Two targeted Windows native scenarios passed on a matching 1.0.2 test build, covering Reading mode and Live Preview, theme switching, editing and undo. The Reading mode diagram screenshot was visually reviewed. The complete native suite and manual macOS acceptance were not run; Linux remains unvalidated.

Windows requires Microsoft Edge WebView2 Runtime. Downloads are unsigned; macOS is not notarized. Automatic updates are not configured. SHA256SUMS.txt lists download checksums.
