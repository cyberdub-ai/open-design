# open-design — форк nexu-io/open-design на хосте .44

`AGENTS.md` (41 КБ) — апстримный, в префикс НЕ включается: читать по разделу и по надобности
(`grep -n '^## ' AGENTS.md`). Править его нельзя — конфликты при синке с upstream.

## Запуск и окружение
- Node 24 только через `PATH=/usr/local/bin:$PATH` (дефолт nvm = Node 20, better-sqlite3 падает).
- Прод — systemd **user** unit `open-design.service` (:7457, `apps/daemon/dist/cli.js`), не docker.
  Рестарт убивает активные раны → делать только с явного согласия владельца:
  `systemctl --user restart open-design.service`. Рядом `pollinations-proxy.service`.
- Caddy `~/stack/n8n/Caddyfile` → `open-design.cyberdub.su` (anon → 401). Токен — `{{OD_API_TOKEN}}`,
  значение не печатать нигде.
- Дома агентов: `CLAUDE_CONFIG_DIR=~/.claude-od`, `CODEX_HOME=~/.codex-od`; `CLAUDE_BIN` в
  `.od/app-config.json` → `~/.local/bin/claude` (обход fcc-обёртки `~/bin/claude`).
- `available=true` в `/api/agents` = бинарь найден, а не авторизован.
- Сборка демона: `pnpm --filter @open-design/daemon build`; `dist/` устаревает молча — сверять
  `stat dist/cli.js` с `git log -1 -- apps/daemon/src`.

## Гейты перед «готово»
`pnpm guard` · `pnpm typecheck` · тесты затронутого пакета (делегировать; полный прогон демона
~8.7k тестов, флейк `tests/mcp-spawn.test.ts` — гонка порта).

## Форк
- Бэклог форка — `docs/BACKLOG.md`, состояние прогонов — `docs/BURN-STATUS.md`, инвентарь — `docs/INVENTORY.md`.
- ⛔ Мерж upstream дважды молча терял фиксы форка (`stdinOpen`, `update_project`): после синка
  прогонять тесты форка из BACKLOG и сверять `git log upstream/main..main -- apps packages`.
- Не рескинить апстримный UI; расширения только через `design-systems/`, `craft/`, `skills/`.
- Коммитить только свои ханки; `git add` по путям.
