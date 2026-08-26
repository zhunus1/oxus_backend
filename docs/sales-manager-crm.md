# Sales Manager CRM: backend-контракт

Этот модуль реализует очередь лидов из Figma для роли `SALES_MANAGER`. Старый публичный `POST /api/v1/leads` и старые expert/admin endpoints сохранены для обратной совместимости и работают только с источником `legacy-contact-form`.

## Модель данных

- `Lead` — общая CRM-карточка: имя, нормализованный `phone_number`, язык, роль, текущий статус и ответственный Sales Manager.
- `LeadSource` — справочник источников (`legacy-contact-form`, `landing-calculator`, `office-manual`).
- `LeadSubmission` — неизменяемый снимок конкретной отправки. `rawPayload` хранит исходную анкету, `normalizedPayload` — общие поля, `metrics` — рассчитанные фронтендом показатели.
- `LeadCallback` — история напоминаний о перезвоне.
- `LeadExpertCall` — запрос Sales Manager на созвон лида с экспертом.
- `LeadActivity` — аудит основных переходов карточки.
- `NotificationLog` — in-app уведомления и отметка прочтения.

Новые источники не требуют добавлять их специфические поля в `Lead`: для каждого источника добавляется адаптер, а оригинальный payload сохраняется в `LeadSubmission.rawPayload`.

`score`, `percent` и `universities` backend не пересчитывает. Расчёт остаётся ответственностью калькулятора; backend проверяет типы и допустимые диапазоны и сохраняет полученные значения без изменений.

## Владение и видимость

- Все Sales Manager видят только нераспределённые лиды со статусом `NEW`.
- `POST /sales/leads/:id/accept` атомарно назначает текущего менеджера. При одновременном принятии побеждает только один запрос, остальные получают `409 Conflict`.
- После принятия карточку видит только назначенный менеджер, включая `NEW` до выбора следующего действия.
- `CALL_SCHEDULED`, `RECALL` и `REJECTED` всегда фильтруются по текущему менеджеру на backend.
- Лид, созданный вручную, остаётся нераспределённым. Создавший менеджер записывается в аудит, но не получает карточку автоматически.

## Публичный калькулятор

`POST /api/v1/public/lead-sources/landing-calculator/submissions`

Авторизация не нужна. Ограничение — 30 запросов в минуту с одного клиентского IP. Максимальный сериализованный payload — 96 KiB. Для корректного определения IP production backend должен оставаться за доверенным Nginx, как в текущем deployment.

Пример совместимого текущего payload:

```json
{
  "submissionId": "fba4498b-3fa5-40ba-9967-365b0c3edb62",
  "quizVersion": "2026-08-26",
  "submittedAt": "2026-08-26T18:41:07.221Z",
  "role": "parent",
  "locale": "kk",
  "name": "Аружан Сейдахмет",
  "phone": "+7 777 482 19 33",
  "score": 935,
  "percent": 93,
  "universities": 50,
  "answers": [
    {
      "question": "Из какого вы города?",
      "answer": "Алматы"
    }
  ]
}
```

Предпочтительный новый формат ответа также поддерживается:

```json
{
  "questionId": "city",
  "optionIds": ["almaty"],
  "freeText": null,
  "questionText": "Из какого вы города?",
  "answerText": "Алматы"
}
```

`submissionId` необязателен, но рекомендуется: это UUID, сгенерированный лендингом один раз перед первой отправкой. Повторный запрос с тем же `submissionId` и источником возвращает существующий `leadId` с `created: false`, не создавая дубликат.

Ответ:

```json
{ "leadId": 123, "created": true }
```

## API Sales Manager

Все пути ниже имеют prefix `/api/v1`, требуют JWT, роль `SALES_MANAGER` и соответствующее permission.

| Метод и путь | Назначение |
| --- | --- |
| `GET /sales/leads?status=NEW&source=&search=&page=1&limit=10` | Видимый менеджеру список |
| `GET /sales/leads/summary` | Счётчики четырёх вкладок |
| `GET /sales/leads/:id` | Карточка, submissions и текущее действие |
| `GET /sales/leads/:id/activities` | История изменений |
| `GET /sales/lead-sources` | Активные источники |
| `POST /sales/leads` | Создать нераспределённый офисный лид |
| `POST /sales/leads/:id/accept` | Атомарно принять новый лид |
| `POST /sales/leads/:id/callbacks` | Назначить перезвон |
| `PATCH /sales/leads/:id/callbacks/:callbackId` | Перенести, завершить или отменить перезвон |
| `POST /sales/leads/:id/reject` | Отклонить с обязательной причиной |
| `GET /sales/experts` | Поиск активных экспертов |
| `GET /experts/:expertUserId/available-slots?from=&to=` | Доступность эксперта с учётом консультаций и Sales-запросов |
| `POST /sales/leads/:id/expert-calls` | Отправить эксперту запрос на созвон |
| `PATCH /sales/leads/:id/expert-calls/:callId` | Изменить только ещё не подтверждённый запрос |
| `GET /notifications` | In-app уведомления текущего пользователя |
| `GET /notifications/unread-count` | Число непрочитанных |
| `PATCH /notifications/:id/read` | Отметить одно уведомление |
| `PATCH /notifications/read-all` | Отметить все уведомления |

Время передаётся в ISO-8601. Перезвон должен попадать на 15-минутную границу. Созвон должен находиться внутри настроенного экспертом блока доступности, начинаться минимум за четыре часа и не пересекаться с консультацией или другим активным Sales-запросом.

Диапазон запроса доступности ограничен 62 днями. Бронирование обычной консультации и Sales-созвона использует одну транзакционную блокировку эксперта, поэтому два параллельных запроса не могут занять один интервал. Завершённый или отменённый перезвон больше нельзя отредактировать; карточка возвращается в `NEW`, сохраняя ответственного менеджера.

Назначение перезвона отменяет активный экспертный созвон и связанную подтверждённую встречу. Назначение экспертного созвона, в свою очередь, отменяет активный перезвон. Отклонение лида отменяет оба действия.

## Интеграция с кабинетом эксперта

Запрос появляется у эксперта сразу после назначения, ещё до подтверждения. Кабинет эксперта должен использовать:

| Метод и путь | Назначение |
| --- | --- |
| `GET /api/v1/expert/lead-calls/pending` | Все ожидающие ответа запросы без пагинационного отсечения |
| `GET /api/v1/expert/lead-calls` | История с фильтром по статусу и пагинацией |
| `GET /api/v1/expert/lead-calls/:id` | Детали своего запроса |
| `PATCH /api/v1/expert/lead-calls/:id/respond` | `{"action":"confirm"}` или `{"action":"decline","comment":"..."}` |

Эксперт не может читать запросы другого эксперта. При подтверждении создаётся календарная запись `Meeting` и возвращается её `meetingId`; до подтверждения запись не создаётся. Авторизация участника CRM-лида в Jitsi этим контрактом не предоставляется: у `Lead` ещё нет учётной записи `User`. При отказе карточка возвращается ответственному Sales Manager в статус `NEW`, но не становится общей.

## Realtime

Socket.IO namespace: `/sales`. JWT передаётся как `auth.token`, `Authorization: Bearer ...` или cookie `accessToken`. Redis adapter распространяет события между экземплярами backend.

Host Nginx должен проксировать `/socket.io/` на backend с заголовками `Upgrade` и `Connection`; готовый блок находится в `deployment/nginx.conf`. Без него REST продолжит работать, но realtime-клиенты за Nginx не подключатся.

Основные события:

- `lead.created`, `lead.accepted`, `lead.updated`, `lead.summary.updated`;
- `expert-call.created`, `expert-call.updated`, `expert-call.removed`;
- `notification.created`.

Клиент после reconnect всегда заново загружает REST-список; WebSocket используется для актуализации интерфейса, а не как единственный источник истины.

## Развёртывание

Миграция `20260826190000_add_sales_manager_crm` аддитивная: старые лиды не удаляются, их исходные данные сначала копируются в legacy submission, затем телефон нормализуется в `phone_number`. Миграция также создаёт роль и permissions, потому что production deploy не обязан выполнять seed.

Перед deployment задайте `CORS_ORIGINS` через запятую. Для Test:

```dotenv
CORS_ORIGINS=https://test.oxusedu.com,https://expert.test.oxusedu.com,https://admin.test.oxusedu.com
```

Если калькулятор размещён на другом origin, его домен тоже необходимо добавить. В production отсутствие `CORS_ORIGINS` закрывает browser-origin запросы; server-to-server запросы без заголовка `Origin` продолжают работать. После выкладки frontend Sales и Expert кабинетов нужно подключить новые REST endpoints и Socket.IO namespace; один backend deploy сам по себе не добавит новые экраны.
