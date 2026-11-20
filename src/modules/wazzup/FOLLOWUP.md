# Wazzup backend: итог повторного ревью 20.11.2026

**Размещение кода в `test` с выключенным Wazzup: CONDITIONAL GO. Включение реальным сотрудникам: NO-GO.** Владелец проекта перенёс полноценную live-проверку на test server. Это не отменяет блокеры R1–R3. Commit, switch, merge, rebase, push и deployment в рамках работы не выполнялись.

## Блокеры и доказательства

| Blocker | Было | Что сделано | Доказательства | Статус |
| --- | --- | --- | --- | --- |
| R1 — отзыв сессий | HIGH; delete user и token claims не доказывают отзыв | Исследован User API v3; подготовлены 10 точных вопросов поддержке и проверка старого URL, активного WS, reconnect, TTL, восстановления user ID | [Provider validation](PROVIDER_VALIDATION.md); в документации не найдена гарантия revoke, `DELETE contact` сохраняет чат в общем окне | OPEN / NOT VERIFIED |
| R2 — изоляция Sales | HIGH; локальные guards не доказывают права внутри iframe | Составлен протокол ADMIN/A/B: карточка, общее окно, поиск, чужой chat ID, смена owner/permission, старая сессия | PostgreSQL HTTP: A→B и B→A запрещены; actual iframe/history/WS ещё не проверены. Нет подготовленных A/B номеров и подтверждённых channel roles | DEFERRED BY USER до test server |
| R3 — lifecycle | HIGH; внешний stale owner возможен несмотря на 409 | Найдены точки CRM mutation, показана гонка запоздалого upsert, описан минимальный gated revoke/transfer/grant и политика общих телефонов | [Lifecycle](LIFECYCLE.md); нет выдуманного CAS, long transaction, миграций или workers | OPEN / зависит от R1 и политики общих номеров |
| Document API | Первичный staff gate: 5 FAIL; контрольный HEAD: 3 аналогичных transport failures | Повторены current/HEAD в одинаковых условиях; воспроизведено без CRM; подтверждён test-only helper раннего отказа до завершения multipart | [Отдельный отчёт](DOCUMENT_TRANSPORT.md); кандидат 222/222 на обеих базах; полный текущий private gate **406/406 дважды** | Локальный test transport gate исправлен; Document production API без изменений |

## Что изменено в этом follow-up

- Только тесты и документация поверх backend-реализации предыдущего ревью; новые runtime API, модели, зависимости и миграции не добавлены.
- Четыре unit-сценария OFF при заданном API key; полный AppModule e2e с настоящей БД проверяет все пять разрешённых ADMIN/Sales запросов при отсутствующем flag: 503 без URL и **0 Axios requests**.
- В запрещённых Document upload/version тестах native HTTP отправляет заголовки большого multipart и 1 KiB, но не завершает тело. Требуется полный JSON 401/403 до окончания upload; reset/timeout/413 не засчитываются как успех. Проверки S3/DB и полных разрешённых файлов сохранены.
- Добавлен независимый HTTP diagnostic probe и подготовлены отдельные provider/lifecycle/release отчёты.
- Локальный `.env`: `WAZZUP_ENABLED=false`, существующие key/channel сохранены. Серверное окружение не изменялось.

Повторные проверки CRM-прав перед записью/ссылкой не обеспечивают атомарность внешнего upsert. Backend OFF не отзывает старый provider token. Эти ограничения явно сохранены, а не объявлены исправленными.

## Итоговая проверка текущего кода

| Проверка | PASS | FAIL | SKIP | Что подтверждает |
| --- | ---: | ---: | ---: | --- |
| Полная Jest suite | 907 | 0 | 0 | Unit/service контракты; внешний Wazzup замокан |
| PostgreSQL/Redis integration | 428 | 0 | 0 | Настоящие disposable БД/Redis; включает Wazzup HTTP/security 11/11 |
| Полный AppModule e2e | 5 | 0 | 0 | Запуск настоящего приложения/БД/Redis/MinIO и OFF HTTP smoke |
| Private student/staff Document API, прогон 1 | 406 | 0 | 0 | Настоящие HTTP/БД/MinIO после test-only исправления |
| Private student/staff Document API, прогон 2 | 406 | 0 | 0 | Полный повторный gate на свежих тестовых данных |

Уникальных тестов в этих четырёх наборах — **1746**; повторные 406 и вложенные Wazzup-наборы не прибавляются. Wazzup Jest subset — **95/95**, HTTP/БД subset — **11/11**; это не live-проверка провайдера. Тестовые процессы используют изолированное окружение без реального ключа Wazzup. Три созданных disposable контейнера удалены с проверкой ownership label; оставшихся контейнеров этой сессии — 0.

TypeScript `tsc --noEmit`, Nest build, полный ESLint TypeScript и отдельный ESLint диагностических MJS — PASS. Git whitespace/secret и конфигурационные проверки — см. ниже. Исходные неудачные прогоны не скрыты: до исправления staff current дал 221/222 и 218/222, clean HEAD — 222/222 и 220/222. Они относятся к исследованию исходного транспорта, а не к финальным gates после patch.

## Реальный Wazzup API — отдельно от mocks

Текущий read-only audit: channels/users/contacts — **200**, один активный выбранный WhatsApp channel, users=0, contacts=0; заведомо неправильный ключ — **401**. Нет новых provider users, contacts, sessions, сообщений или изменений channel settings в этом follow-up. Эта ручная диагностика обращалась к API напрямую; она не означает включение backend-флага.

Первичный аудит до follow-up создал только временного технического пользователя, проверил повторный upsert, получил iframe URL и удалил пользователя (200, затем GET 404). В claims наблюдалось `exp - iat = 28800`; это **не подтверждённый SLA TTL**, проверка подписи или revoke. Реальная история, поиск, чужие чаты, активный WS и повторное использование старого token не проверялись. Подробности и недостающие ресурсы — [в протоколе](PROVIDER_VALIDATION.md).

## Доступ по ролям

| Роль | Backend при будущём включении | Провайдерные ограничения |
| --- | --- | --- |
| ADMIN | Channels, общее окно; карточка любого неудалённого лида с валидным телефоном. Не переприсваивает contacts backend-запросом | Роль «Руководитель» на тестовом канале; фактический scope определяется Wazzup |
| SALES_MANAGER | Действующий `SALES_LEADS_MANAGE_OWN`; только свои принятые неудалённые лиды, валидные телефоны. Channels — 403; пустая выборка не превращается в global | Требуется «Менеджер»; реальная изоляция iframe и отзыв старых сессий не доказаны |
| EXPERT и остальные | Новые Wazzup endpoints — 403 | Доступ не выдаётся backend |

Сейчас при OFF разрешённые ADMIN/Sales запросы получают 503 `WAZZUP_NOT_CONFIGURED`; неподходящие роли/JWT по-прежнему отклоняются guards. [Frontend contract](FRONTEND.md) содержит точные paths, ответы, коды ошибок и требования к хранению URL. Frontend не изменялся.

## Решение для Git/test и включения

**CONDITIONAL GO — код в `test` с OFF.** Оба env example и обе Compose-конфигурации имеют default false; значение отсутствующего флага также выключает интеграцию. OFF с валидными ролями проверен настоящим приложением. Dockerfile не задаёт true; секреты не включены в build context. Существующие CRM API/Document production code не меняются.

До отправки, запускающей test deployment, оператор должен проверить фактический `WAZZUP_ENABLED=false` в server Compose вместе с override, затем пройти CI. Server environment не инспектировался этой работой. Push `test` автоматически публикует image и запускает `deploy-test`; SSH workflow **не копирует** новый Compose или локальный `.env` на сервер. Поэтому безопасный следующий шаг — feature branch + draft PR в `test`, а merge/deploy после server OFF preflight, отдельным разрешением. Готовые команды, список файлов, два commit messages и env matrix — в [RELEASE.md](RELEASE.md).

**NO-GO — включение и доступ реальным сотрудникам.** Нужны ответы поддержки/фактический revoke и проверка активного WS, live ADMIN/A/B изоляция, доказанный порядок обновления owner/phone и согласованная политика одинаковых телефонов. Для будущей технической live-проверки требуется отдельный test account, контролируемые номера, роли и согласованное окно. Готовность OFF не закрывает эти требования.

## Git и границы изменений

Checkout `test`, HEAD/local origin/test `24dbad339e0c49b304da996a18a95d6845576f52`; проверенный remote `test` совпадает. Изменения не staged/committed. Нет package/lockfile, Prisma schema/migration, production Document module или frontend diff. Полный список файлов и команды безопасного feature PR приведены в [RELEASE.md](RELEASE.md).

`git diff --check` и проверка новых файлов на whitespace — PASS. Проверка фактического API key из игнорируемого `.env` против всех добавленных/изменённых файлов — **0 совпадений**; key не выводился. Локальный `.env`, generated/dist и временные отчёты не входят в commit. Полные session URL не сохраняются в документации или выводе аудита.

Временные результаты сравнений и повторных suites сохранены локально в `/private/tmp/oxus-wazzup-*`; это рабочие доказательства этой сессии, не долговременный CI artifact и не файлы для коммита. Историческое первичное [REVIEW.md](REVIEW.md) сохранено с указателем на этот follow-up.
