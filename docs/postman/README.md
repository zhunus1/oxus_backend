# Postman: Sales Manager CRM

## Импорт

1. Импортировать `oxus-sales-crm.postman_collection.json`.
2. Импортировать и выбрать environment `oxus-test.postman_environment.json`.
3. Заполнить `salesEmail`, `salesPassword`, `expertEmail`, `expertPassword`. Секреты в Git не сохранять.
4. Выполнить `Sign in — Sales Manager` и `Sign in — Expert`. Коллекция сама сохранит оба JWT.

## Предварительные условия

- пользователь Sales Manager имеет роль `SALES_MANAGER` и CRM permissions;
- эксперт имеет роль `EXPERT`, активный `ConsultantProfile` и настроенные интервалы доступности;
- перед созданием экспертного созвона нужно выполнить `Get expert available slots` и подставить реальный свободный интервал в `callStartAt`/`callEndAt`;
- `leadId`, `callbackId`, `expertUserId`, `expertCallId` и `notificationId` заполняются тестовыми скриптами Postman;
- для нового полного сценария очистить collection variables `submissionId`, `leadId`, `callbackId` и `expertCallId`.

Не запускайте всю коллекцию подряд бездумно: `Reject owned lead`, `Confirm lead call` и `Decline lead call` — альтернативные терминальные ветки. Для каждой из них создайте и примите отдельный лид.

## Realtime

REST-коллекция не заменяет Socket.IO-клиент. Sales-интерфейс подключается к namespace `/sales`, передавая JWT как `auth.token`, и слушает:

- `lead.created`, `lead.accepted`, `lead.updated`, `lead.summary.updated`;
- `expert-call.created`, `expert-call.updated`, `expert-call.removed`;
- `notification.created`.

После каждого reconnect frontend заново загружает REST-список. WebSocket-события используются как сигнал актуализации, а не как единственный источник данных.
На сервере путь `/socket.io/` должен быть проксирован в backend с WebSocket upgrade; эталонный блок находится в `deployment/nginx.conf`.

```ts
import { io } from "socket.io-client";

const socket = io("https://test.oxusedu.com/sales", {
  auth: { token: salesAccessToken },
});
```

Полное описание поведения и ограничений находится в `docs/sales-manager-crm.md`.
