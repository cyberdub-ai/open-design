# Open Design — STATUS

Self-hosted Claude Design alternative на 44 машине.
URL: https://open-design.cyberdub.su
Daemon: port 7457, systemd user service `open-design.service`

## Текущий статус: ✅ LIVE + Image Gen через Pollinations (upstream sync 2026-05-25)

## Что сделано

- Установлен и задеплоен Open Design daemon + web UI
- Caddy reverse proxy → open-design.cyberdub.su
- Gemini wrapper: убраны ss-проверки портов (быстрее на ~0.5s)
- Импортировано 1294 дизайн-системы из refero.design в design-systems/refero-*/
  - Скрипт: tools/import-refero-styles.py
  - 397 written, 926 skipped, 0 errors (финальный прогон 2026-05-07)
- MCP сервер добавлен в ~/.claude.json: open-design → ✓ Connected
- **Image generation**: Pollinations.ai proxy (полностью бесплатно)
  - Сервис: pollinations-proxy.service (порт 7778)
  - Скрипт: ~/projects/pollinations-proxy/server.py
  - Модель: Flux (лучшее качество у Pollinations)
  - Конфиг: .od/media-config.json → openai.baseUrl = http://127.0.0.1:7778/v1
  - В Open Design UI: Settings → Media Providers → OpenAI → уже настроен
- **Git**: Fork → https://github.com/cyberdub-ai/open-design
  - origin = git@github.com:cyberdub-ai/open-design.git (наш форк)
  - upstream = https://github.com/nexu-io/open-design (автор)
- **Upstream sync 2026-05-25**: смержены design system review panel #2848, rename editable DS #2812, Trae CLI ACP #2856. Конфликты — взяли --ours (write tools MCP сохранены). Добавили validateProjectDesignSystemId в server.ts + validation deps в registerProjectRoutes/registerImportRoutes (upstream-ломающий рефакторинг).

## Update workflow (получить обновления автора)

```bash
cd ~/projects/open-design
git fetch upstream
git merge upstream/main   # или rebase для чистой истории
pnpm install              # если изменились зависимости
pnpm --filter @open-design/daemon build
systemctl --user restart open-design.service
```

Перед merge проверить свои изменения: `git log upstream/main..HEAD`

## Конфиги

- Service: ~/.config/systemd/user/open-design.service
- Pollinations proxy: ~/.config/systemd/user/pollinations-proxy.service
- Media config: ~/projects/open-design/.od/media-config.json
- Design systems: ~/projects/open-design/design-systems/ (1432 total, 1294 refero)
- MCP: ~/.claude.json → mcpServers.open-design
