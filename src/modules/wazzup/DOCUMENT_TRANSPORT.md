# Document API: исследование ECONNRESET/EPIPE

20.11.2026. Отдельная от Wazzup проблема тестового HTTP-транспорта. Production Document API, его guards, multipart limits, storage и модели **не изменены**. Исправлены только негативные тесты раннего отказа в `test/document-staff-api.test.ts`; воспроизводитель — `test/document-transport-probe.mjs`.

## Исходная проблема

В первичном ревью private API runner дал student 184/184 и staff 217/222. Ошибки staff возникали при отправке запрещённого файла `50 MiB + 1` через `.attach(Buffer.alloc(...))`, пока guard уже возвращал 403. В контрольной копии чистого HEAD было 3 аналогичных ошибки. Это не пять фиксированных бизнес-дефектов: число и конкретные случаи менялись.

## Сопоставимые повторные прогоны до исправления

Все четыре прогона: один Node.js 22.15.1/macOS, одни и те же Supertest 7.2.2, Superagent 10.3.0, form-data 4.0.5, изолированные PostgreSQL 15/MinIO, новый мигрированный database для каждого запуска, последовательный runner `--test-concurrency=1`. Текущий code и архив чистого HEAD `24dbad339e0c49b304da996a18a95d6845576f52` чередовались. В этой фазе исходный staff test ещё был одинаковым.

| Прогон staff suite | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Current 1 | 221 | 1 | 0 |
| Clean HEAD 1 | 222 | 0 | 0 |
| Current 2 | 218 | 4 | 0 |
| Clean HEAD 2 | 220 | 2 | 0 |

Конкретные test cases, где возник хотя бы один FAIL:

| Test case | Current 1 | HEAD 1 | Current 2 | HEAD 2 |
| --- | --- | --- | --- | --- |
| STUDENT denied staff version | FAIL | PASS | PASS | PASS |
| SCHOOLBOY denied staff upload | PASS | PASS | FAIL | PASS |
| SCHOOLBOY denied staff version | PASS | PASS | PASS | FAIL |
| SALES_MANAGER denied staff upload | PASS | PASS | FAIL | PASS |
| SALES_MANAGER denied staff version | PASS | PASS | FAIL | PASS |
| SUPPORT denied staff version | PASS | PASS | FAIL | FAIL |

Остальные случаи этих прогонов прошли. Один удачный чистый прогон не считается доказательством отсутствия проблемы; все результаты сохранены, не выбран только зелёный.

## Минимальный независимый воспроизводитель

`node test/document-transport-probe.mjs 16` не импортирует CRM, Nest, Prisma, storage или Wazzup. Обычный `node:http` server возвращает 403; меняется только способ отправки тела/завершения соединения. Он запускается обычным Node, поэтому для воспроизведения `node:test` runner не требуется.

| Режим, 16 попыток | macOS / Node 22.15.1: полный 403 / transport error | Linux / Node 22.23.5: полный 403 / transport error |
| --- | --- | --- |
| Supertest, 50 MiB + 1, ранний 403, Connection close | 13 / 3 | 16 / 0 |
| Supertest, тот же большой файл, keep-alive | 16 / 0 | 16 / 0 |
| Superagent напрямую, большой файл, ранний 403, close | 14 / 2 | 16 / 0 |
| Supertest, файл 1 KiB, ранний 403, close | 16 / 0 | 16 / 0 |
| Supertest, большой файл, server сначала дочитывает body | 16 / 0 | 16 / 0 |
| Native HTTP, multipart header + 1 KiB, тело намеренно не завершено | 16 / 0 | 16 / 0 |

Linux probe использовал тот же JS dependency tree в существующем тестовом образе; внешний network отключён. Одновременно различались minor Node и ОС, поэтому эти измерения **не доказывают**, что конкретное обновление Node исправляет проблему. Маскировать её обновлением зависимости/повторами не предлагается.

## Причина и классификация

Клиент продолжает писать большой multipart в TCP-соединение, по которому server уже отправил ранний отказ и закрывает соединение. В зависимости от порядка I/O клиент получает EPIPE/ECONNRESET до того, как успеет разобрать конечный HTTP-ответ. Это независимо воспроизводится с Superagent и без CRM, поэтому не является новой регрессией Wazzup или доказательством обхода авторизации.

Проверенный Superagent при request write error до формирования parsed response завершает callback ошибкой; в форме отправки multipart большой Buffer направляется в поток. Отсюда `req.expect(403)` не может гарантированно увидеть 403 при каждом запрещённом 50 MiB upload. Простая замена Jest/node:test или постоянный listen не исправляют общую проблему: исходный staff suite уже использует `app.listen(0, "127.0.0.1")`.

Это существующая транспортная гонка сценария «большой запрещённый upload одновременно с ранним отказом», усиленная формой негативного теста. Она может наблюдаться и клиентами при таком сценарии; это не обещание, что production client всегда получит JSON вместо network error. Проверяемая бизнес-семантика guards и отсутствие побочных эффектов от этого не становятся неверными. Аналогичный риск потери последнего ответа при TCP reset описан в [RFC 9112, §§9.5–9.6](https://www.rfc-editor.org/rfc/rfc9112.html#section-9.6).

## Минимальное исправление, применённое только в тестах

Для запрещённых upload/version запросов native HTTP helper:

1. Отправляет корректные multipart headers с объявленным размером файла выше 50 MiB и небольшую начальную часть body.
2. **Не завершает** multipart и не отправляет остаток файла: guard обязан вернуть 401/403, не дожидаясь parser/buffering.
3. Требует полностью прочитанный HTTP response (`incoming.complete`), корректный JSON и точный 401/403.
4. Если приходит reset, timeout, неполный ответ, 413, иной статус или parser ждёт конец body — тест падает. Ошибки транспорта не превращаются в искусственный успех.
5. Сохраняет прежние проверки: S3 calls не увеличились, документ не изменился, ответ не содержит внутренних полей.

Проверки полных разрешённых файлов 50 MiB, отказа на MAX+1, лимитов параллелизма и других Document API контрактов остались неизменными. Server не заставляют дочитывать/буферизовать 50 MiB неавторизованного запроса ради теста. Нет retries, увеличения production limits, удаления assertions или разрешения EPIPE вместо 403.

Перед переносом patch кандидат во временном test-файле прошёл **222/222** с текущим production backend и **222/222** с чистым HEAD. Основной Document API test изменён только после этого подтверждения. Это отдельный test-only commit, а не расширение интеграции Wazzup.

Итоговые полные private student/staff gate-прогоны после переноса фиксируются в [FOLLOWUP.md](FOLLOWUP.md). Все предшествующие FAIL остаются частью истории исследования; результаты кандидата не заменяют текущий gate.

## Воспроизведение

```bash
node test/document-transport-probe.mjs 16
yarn build
yarn test:documents-private-api
```

Для private API использовать только disposable loopback `DATABASE_URL`, оканчивающийся на `_test`, и штатный MinIO runner. Не подавлять ошибки и не запускать на рабочей БД. Probe выводит наблюдения, а не CI-вердикт: наличие transport errors в диагностическом режиме само является воспроизводимым наблюдением, а не разрешённым результатом auth-теста.
