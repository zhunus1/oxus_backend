# Подготовка Wazzup backend к test с интеграцией OFF

20.11.2026. Исходный план выкладки и финальный preflight. Владелец разрешил подготовить два локальных коммита; **фактический push требует отдельного разрешения после подтверждения server OFF**. Включение Wazzup реальным сотрудникам не одобрено. Live-проверка перенесена владельцем проекта на test server.

## Финальный preflight перед отправкой

- Удалённая `test` повторно проверена через GitHub: `24dbad339e0c49b304da996a18a95d6845576f52`, совпадает с базой локальных изменений. Все 27 файлов относятся к согласованному этапу; runtime-код после успешных проверок не менялся, suites повторно не запускались.
- SSH к `test.oxusedu.com` под `oxusdeploy` работает. Этот пользователь не может читать `/opt/oxus_backend/deployment/.env` и Compose, не имеет доступа к Docker socket. `sudo -n -l` разрешает только backend/frontend `deploy.sh`; эти скрипты не запускались ради чтения конфигурации.
- **Server OFF и совместимость фактического server Compose не подтверждены из-за прав доступа.** Нужен оператор с правами чтения: подтвердить явное `WAZZUP_ENABLED=false` в server `.env`, эффективный OFF в Compose с override и совместимость backend image. Команды ниже; секреты не выводить. Не менять SSH/sudo permissions ради этой проверки.
- До подтверждения оператора и отдельного разрешения владельца push/автодеплой заблокированы. Post-deploy health, runtime OFF, авторизованный 503 и CRM smoke пока NOT RUN.

После обоих подтверждений для двух локальных коммитов на текущей `test` подготовлена команда `git push origin HEAD:refs/heads/test` без force. Непосредственно перед ней повторно сравнить remote `test` с указанной базой; при изменении SHA остановиться. Команда пока не выполнялась. Альтернативный feature PR ниже сохранён как исходный план, его команды создания ветки/коммитов повторять поверх уже созданных коммитов не нужно.

## Два разных решения

- Размещение backend-кода с OFF: **CONDITIONAL GO** — локальные проверки выключенного режима пройдены, но до автодеплоя оператор должен подтвердить эффективный OFF на реальном test server и дождаться зелёного CI.
- Включение доступа сотрудникам: **NO-GO** — R1/R2/R3 не закрыты. Сначала [provider validation](PROVIDER_VALIDATION.md), ответы поддержки и согласованный lifecycle.

OFF запрещает новые API-вызовы приложения и выдачу URL; он не отзывает ранее выпущенные provider sessions. Оператор должен учитывать уже существующий доступ отдельно. При текущей read-only проверке тестового Wazzup account users/contacts было 0; это не утверждение о других аккаунтах.

## Переменные окружения

| Переменная | Для безопасного размещения | Для будущей технической live-проверки |
| --- | --- | --- |
| `WAZZUP_ENABLED` | **false**; при отсутствии тоже false | true только в согласованном test-окне |
| `WAZZUP_API_KEY` | Можно оставить пустой; если уже задан, OFF всё равно запрещает внешние вызовы | Полный ключ отдельного test account, не Sidecar |
| `WAZZUP_CHANNEL_ID` | Не обязателен | Проверенный активный test WhatsApp/WABA channel |

Оба example-файла и обе Compose-конфигурации дают false. Render проверен для local/server templates и server env без Wazzup-переменных. Dockerfile не задаёт true; `.env`/secrets исключены из image context. Runtime по умолчанию выключен. Локальный реальный `.env` переключён в false, ключ и channel ID сохранены; серверное окружение не изменялось.

При OFF проверены действующие ADMIN и Sales через полный AppModule с реальной БД: все пять разрешённых маршрутов возвращают 503 `WAZZUP_NOT_CONFIGURED`, URL отсутствует, Axios API requests — 0. Отдельный unit-тест подтверждает OFF даже при наличии ключа. Штатные authentication/authorization отказы 401/403 по-прежнему применяются.

## Почему push не равен простому сохранению

`.github/workflows/ci.yml`: push в `test` запускает quality → Docker publish → `deploy-test`. Push в feature-ветку сам по себе не деплоит; PR в `test` запускает quality/build без публикации и деплоя. Production job относится к `main`.

SSH deployment передаёт server script **environment и immutable image digest**. Он не доставляет автоматически новую `deployment/compose.yaml` и не переносит локальный `.env`. Server Compose и override необходимо проверять на самом сервере. Старый Compose может вообще не передавать Wazzup-переменные: новый backend тогда остаётся OFF по умолчанию. При будущей live-проверке обновление server Compose — отдельное контролируемое действие, не выполненное этим ревью.

## Обязательная проверка оператора на test server

До обновления `test` задать в `/opt/oxus_backend/deployment/.env` явное `WAZZUP_ENABLED=false`, не публикуя остальные значения. Затем проверить **эффективную** конфигурацию с тем же override, который использует deploy script:

```bash
cd /opt/oxus_backend/deployment
compose_files=(-f compose.yaml)
if [[ -f compose.override.yaml ]]; then
  compose_files+=(-f compose.override.yaml)
fi
docker compose --project-name oxus_backend --env-file .env "${compose_files[@]}" config --format json |
  python3 -c 'import json,sys; c=json.load(sys.stdin); flags={s:str(c["services"][s].get("environment",{}).get("WAZZUP_ENABLED","false")).strip().lower() for s in ("backend","migrator")}; print(json.dumps(flags)); sys.exit(0 if all(v=="false" for v in flags.values()) else 1)'
```

Команда выводит только флаги, не key и не полную Compose-конфигурацию. Если вывод/exit-code не подтверждает OFF — stop. Эта server-проверка в текущей работе **не выполнена**, поэтому deploy-решение условное. `WAZZUP_ENABLED=true` из локального `.env` переносить на сервер нельзя.

После отдельно разрешённого test deploy проверить health и фактическое окружение backend без вывода секретов:

```bash
docker compose --project-name oxus_backend --env-file .env "${compose_files[@]}" exec -T backend node -e 'const value=String(process.env.WAZZUP_ENABLED??"false").trim().toLowerCase(); console.log(JSON.stringify({wazzup_enabled:value})); if(value!=="false")process.exit(1)'
```

Затем вызвать Wazzup endpoint с разрешённым техническим CRM JWT: ожидается 503 `WAZZUP_NOT_CONFIGURED`, не session URL. Не сохранять JWT в историю shell/логи. Включение в test для live-проверки требует отдельного шага и не следует автоматически из успешного deploy.

## Изменения для коммитов

Рекомендуется отделить подтверждённый test-only Document fix от Wazzup:

1. `test(documents): verify early multipart rejection without socket races`
   - `test/document-staff-api.test.ts`;
   - `test/document-transport-probe.mjs`;
   - `src/modules/wazzup/DOCUMENT_TRANSPORT.md`.
2. `feat(wazzup): add opt-in backend chats with access checks`
   - `.env.example`, `README.md`, `compose.yaml`;
   - `deployment/.env.example`, `deployment/compose.yaml`;
   - `src/app.module.ts`;
   - `src/modules/wazzup/wazzup.module.ts`, `wazzup.controller.ts`, `wazzup.service.ts`, `wazzup.client.ts`;
   - три `src/modules/wazzup/*.spec.ts`;
   - `src/modules/wazzup/README.md`, `FRONTEND.md`, `REVIEW.md`, `FOLLOWUP.md`, `PROVIDER_VALIDATION.md`, `LIFECYCLE.md`, `RELEASE.md`;
   - `test/wazzup-http.test.ts`, `test/wazzup-live-review.mjs`;
   - `test/run-integration.mjs`, `test/app.e2e-spec.ts`.

`.env`, `/private/tmp` evidence, `dist/`, generated client, credentials и сессионные ссылки не добавлять. Внешних provider writes при OFF код не делает. Ручной `wazzup-live-review.mjs` — отдельная диагностическая утилита с API key, не часть приложения/автоматического CI и не включена в server image.

## Команды, подготовленные для отдельного разрешения

На момент составления исходного плана checkout был `test`, HEAD `24dbad339e0c49b304da996a18a95d6845576f52`, изменения ещё не staged/committed. Ниже сохранён альтернативный путь через feature-ветку и PR; фактический финальный preflight указан в начале документа.

Перед командами проверить, что remote `test` не ушёл вперёд. Если SHA отличается, не применять force и не делать автоматический merge/rebase: заново проверить diff на обновлённой базе.

```bash
git status --short
git diff --check
git ls-remote origin refs/heads/test
git switch -c feature/wazzup-backend-disabled

git add -- test/document-staff-api.test.ts test/document-transport-probe.mjs src/modules/wazzup/DOCUMENT_TRANSPORT.md
git diff --cached --check
git commit -m "test(documents): verify early multipart rejection without socket races"

git add -- .env.example README.md compose.yaml deployment/.env.example deployment/compose.yaml src/app.module.ts src/modules/wazzup test/wazzup-http.test.ts test/wazzup-live-review.mjs test/run-integration.mjs test/app.e2e-spec.ts
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
git commit -m "feat(wazzup): add opt-in backend chats with access checks"
git push --set-upstream origin feature/wazzup-backend-disabled
```

Проверка staged diff на секреты обязательна до commit; default false не должен быть заменён на true. Если имя feature-ветки уже занято, остановиться и выбрать отдельное имя, не перезаписывать ветку.

Подготовленный PR:

```bash
cat > /tmp/oxus-wazzup-pr.md <<'EOF'
Adds opt-in Wazzup chat endpoints for ADMIN and owned, accepted Sales leads. The integration defaults to disabled and does not call Wazzup during startup or valid OFF requests. Existing CRM contracts and database schema are preserved.

Fixes Document authorization tests to require a complete denial before multipart completion, avoiding the verified large-upload/early-close socket race without changing Document API behavior.

Validation: see src/modules/wazzup/FOLLOWUP.md. Provider session revocation and live Sales isolation remain unverified; enabling real staff access is not approved. Merge to test requires green CI and confirmed WAZZUP_ENABLED=false on the Test server.
EOF
gh pr create --draft --base test --head feature/wazzup-backend-disabled --title "Add disabled Wazzup backend integration and access validation" --body-file /tmp/oxus-wazzup-pr.md
```

После зелёного CI и подтверждения server OFF — отдельное решение о merge в `test`, которое запустит автодеплой. Никаких команд merge/прямого push в `test` или production deploy здесь не выполнялось. Готовность положить выключенный код не закрывает R1–R3 и не разрешает включить интеграцию.
