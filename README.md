# RIFT — турнирная платформа PC-клуба (CS2)

Сайт для проведения турниров по CS2: турниры создаёт админ, список игроков
импортируется из Excel, история игр (по загруженным `.dem` файлам) считает
статистику и рейтинг игроков по собственной методике "в духе" FACEIT/HLTV.

Стек:
- **frontend** — Vue 3 + Vite, чёрно-красная тема (см. `frontend/src/assets/styles/theme.css`)
- **backend** — Node.js/Express + PostgreSQL (своя локальная БД, без внешних SaaS)
- **demo-parser** — Python/FastAPI сервис на `demoparser2` для разбора `.dem` файлов
- **postgres** — своя база данных в Docker-контейнере

## ⚠️ Важно про безопасность (прочитать перед стартом)

В присланных вами `server.js`/`.env` (пример импорта из Google Sheets) был
захардкожен приватный ключ Google Service Account и ключ Supabase с
префиксом `sb_secret_...` (похоже на секретный, а не публичный ключ). Этот
проект их **не использует** — своя БД поднимается локально в Docker. Но так
как эти ключи уже были один раз показаны вовне, рекомендую:
1. Перевыпустить ключ Google Service Account в Google Cloud Console (IAM → Service Accounts → Keys).
2. Проверить в Supabase (если продолжите им пользоваться где-то ещё), какой именно это ключ — `anon` или `service_role` — и не светить `service_role` во фронтенде.
3. Никогда не коммитить `.env` в git (см. `.gitignore` — он уже настроен).

## Быстрый старт (Docker Compose)

```bash
cp .env.example .env
# отредактируйте .env — обязательно смените POSTGRES_PASSWORD и JWT_SECRET

docker compose up -d --build
```

После первого запуска применить схему БД (обязательно — без этого шага любой
запрос к API будет падать с ошибкой вида `relation "admins" does not exist`,
т.к. таблицы ещё не созданы):

```bash
docker compose exec backend npm run migrate
```

Должно вывести `✅ Схема применена успешно`. Если видите `relation ... does not
exist` уже после этой команды — либо она не была запущена, либо образ backend
собран до какого-то момента и его нужно пересобрать: `docker compose up -d --build backend`,
затем повторить `docker compose exec backend npm run migrate`.

Создать первого админа — откройте в браузере (путь специально нигде не показан в навигации):

```
http://localhost:8080/admin/setup
```

Заполните форму — она создаст админа и сразу залогинит вас в `/admin`. Форма
работает только один раз, пока в базе нет ни одного админа: после первого
успешного создания `register-first-admin` на бэкенде сам себя закрывает, и
дальше вход только через `/admin/login`.

Тот же результат через curl, если нужно (например, для CI):

```bash
curl -X POST http://localhost:3000/api/auth/register-first-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@rift.local","password":"смени_меня_на_надёжный","displayName":"Admin"}'
```

Дальше:
- Фронт: http://localhost:8080
- Backend API: http://localhost:3000/api
- Demo-parser (внутренний сервис, наружу не публикуется): порт 8001 внутри docker-сети

## Если парсинг демки падает с `EntityNotFound`

Это исключение самой библиотеки `demoparser2`, а не наш код — она не может
прочитать данные какого-то игрока/сущности из демки. Есть частая причина,
из-за которой это не баг, а особенность конкретного файла: **POV-демка**
(записанная одним игроком через `record` в своём клиенте) физически не
содержит данных об игроках, которых этот клиент не рендерил (вне поля
зрения/PVS) — в отличие от **GOTV/серверной демки**, где есть данные обо
всех. Для турниров нужна именно вторая — та, что отдаёт сервер целиком
(например, через GOTV, `mm_dedicated_recorddemo`, или что пишет Get5/MatchZy
на выделенном сервере), а не файл, который скачал себе один из игроков.

Чтобы понять, в чём дело именно у вас — есть скрипт диагностики, который
пробует базовые вызовы по одному на реальном файле и печатает, что именно
падает и какие колонки на самом деле отдаёт библиотека:

```bash
# сначала посмотреть, как называется загруженный файл
docker compose exec backend ls -la /app/backend/uploads/demos

# затем прогнать диагностику на нём (demo-parser видит те же файлы в /app/uploads)
docker compose exec demo-parser python3 app/diagnose.py /app/uploads/demos/ИМЯ_ФАЙЛА.dem
```

Пришлите весь вывод — по нему сразу видно, GOTV это или POV, какая версия
`demoparser2` реально стоит и на каком конкретно вызове/колонке падает.

## Разработка без Docker

```bash
# БД — поднимите Postgres 16 локально или через docker compose up -d postgres

cd backend
cp .env.example .env   # укажите DATABASE_URL на вашу локальную postgres
npm install
npm run migrate
npm run dev             # http://localhost:3000

cd ../frontend
cp .env.example .env
npm install
npm run dev              # http://localhost:5173

cd ../demo-parser
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

## Как устроен импорт Excel

`POST /api/tournaments/:id/import-players` (админ, `multipart/form-data`, поле `file`).
Первая строка листа — заголовки, колонки узнаются по названию (см.
`backend/src/services/excelImport.service.js`, объект `HEADER_SYNONYMS`):
дата, имя, telegram, ник, ссылка на faceit, elo, часы в игре. Порядок колонок
не важен, лишние колонки просто игнорируются (но сохраняются в `raw_row` на
всякий случай). Если под ваш конкретный шаблон Excel синонимы не подходят —
просто добавьте вариант написания заголовка в `HEADER_SYNONYMS`.

## Автосинк списка игроков из живой Google-таблицы

Альтернатива разовой загрузке .xlsx — если игроки регистрируются, например,
через Google Форму и попадают в Google-таблицу, RIFT может сам подтягивать
оттуда актуальный список каждые 1–2 минуты (без ручной выгрузки в .xlsx и
загрузки на сайт). Работает через Google Sheets API с приватной таблицей —
никаких данных наружу не публикуется.

**Настройка (один раз):**

1. В [Google Cloud Console](https://console.cloud.google.com/) создайте
   проект (или возьмите существующий) и включите **Google Sheets API**
   (APIs & Services → Library → найти "Google Sheets API" → Enable).
2. IAM & Admin → Service Accounts → **Create Service Account** (роли не
   нужны — доступ даётся через шаринг самой таблицы, не через IAM).
3. У созданного сервис-аккаунта: Keys → Add Key → Create new key → **JSON** —
   скачается файл ключа.
4. Положите этот файл в `secrets/google-sheets-sa.json` в корне репозитория
   (папка `secrets/` уже в `.gitignore` — в git не попадёт, но проверьте перед
   коммитом на всякий случай).
5. Откройте вашу Google-таблицу → **Настройки доступа** → добавьте email
   сервис-аккаунта (поле `client_email` внутри скачанного JSON, выглядит как
   `имя@проект.iam.gserviceaccount.com`) с правом **Читатель**.
6. Скопируйте ID таблицы из её URL:
   `https://docs.google.com/spreadsheets/d/ЭТОТ_ID/edit`.
7. Пересоберите backend, чтобы он увидел смонтированный ключ:
   `docker compose up -d --build backend`.
8. В админке откройте нужный турнир → блок «Google Sheets — автосинк» →
   вставьте ID таблицы и диапазон (например, `Лист1!A:Z` — имя листа берётся
   с нижней вкладки таблицы, точное совпадение регистра и названия важно) →
   включите тумблер → «Сохранить».

Дальше бэкенд сам, каждые 90 секунд (настраивается `SHEET_SYNC_INTERVAL_MS`
в `.env`), читает таблицу и обновляет список игроков турнира — той же
логикой, что и ручной импорт (игрок ищется по нику/faceit-ссылке, при
повторном синке не дублируется, только обновляются seed-рейтинг/часы).
Статус последнего синка (время / ошибка) виден там же, в блоке настройки.

**Если у вас уже поднята БД** (создана до этой фичи) — `migrate.js`
не идемпотентен, схему нужно доростить вручную:

```bash
docker compose exec postgres psql -U rift -d rift -c "
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS sheet_id TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS sheet_range TEXT DEFAULT 'A:Z';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS sheet_sync_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS sheet_last_synced_at TIMESTAMPTZ;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS sheet_last_sync_error TEXT;
"
```

## Как устроен разбор демок и рейтинг

1. Админ загружает `.dem` через `POST /api/matches/:id/demo` — файл сохраняется
   на диск backend-контейнера, создаётся запись в `demos` со статусом `pending`,
   ответ приходит сразу (202), а разбор идёт в фоне.
2. Backend отправляет файл в Python-сервис `demo-parser` (`POST /parse`), который
   через `demoparser2` вытаскивает по каждому раунду: килы, урон, ассисты,
   хедшоты, entry kill/death, трейды, клатчи, мультикилы.
3. Backend считает **match rating** — открытую реконструкцию HLTV Rating 2.0
   (см. `backend/src/services/rating.service.js`), и **ELO swing** — изменение
   общего рейтинга игрока: команда получает/теряет очки по стандартной ELO-формуле
   относительно ожидания (разница среднего эло команд), а внутри команды это
   изменение распределяется пропорционально тому, кто сыграл сильнее/слабее
   среднего по своей команде в этом матче.
4. Прогресс можно отслеживать через `GET /api/demos/:id` (статус: `pending` →
   `parsing` → `parsed`/`error`) — фронт можно допилить поллингом этого эндпоинта,
   если нужен live-статус прямо на странице матча (сейчас статус обновляется при
   обновлении страницы).

**Важная оговорка:** это не официальная формула FACEIT или HLTV — точные
алгоритмы обеих платформ закрыты. Это открытая, задокументированная в коде
методика "в похожем духе". При желании поменять веса/K-фактор — правьте
`rating.service.js`, там всё в одном месте.

**Также:** `demoparser2` — быстро развивающаяся библиотека, точные имена
колонок в её ответах (`parse_event`) могут немного отличаться между версиями.
Если после первого реального `.dem` парсинг упадёт на конкретном поле —
смотрите `demo-parser/app/parser.py`, там подробные комментарии, что и откуда
берётся, поправить нужно будет только там.

## Структура проекта

```
RIFT/
├── db/schema.sql              — вся схема Postgres одним файлом
├── backend/                   — Express API
│   └── src/
│       ├── routes/            — auth, tournaments, matches, demos, players
│       ├── services/          — excel-импорт, рейтинг, вызов demo-parser
│       └── config/db.js       — подключение к Postgres
├── demo-parser/                — FastAPI + demoparser2
│   └── app/parser.py           — вся логика разбора демки
├── frontend/                   — Vue 3 + Vite
│   └── src/
│       ├── views/               — публичные страницы
│       └── views/admin/         — админка
└── docker-compose.yml
```

## Дальнейшие шаги / что можно улучшить

- Сейчас первая команда, у которой демка сматчилась по ростеру, определяет
  сторону A/B — если ростеры команд не заполнены до матча, сопоставление
  идёт по эвристике из демки (может путать A/B, но статистика и рейтинг
  всё равно посчитаются верно).
- Загрузка `.dem` сейчас синхронно шлётся в demo-parser HTTP-запросом с
  таймаутом 10 минут — для больших нагрузок (много демок разом) стоит
  добавить очередь (например, BullMQ + Redis), сейчас для клуба это, скорее
  всего, избыточно.
- Поллинг статуса демки на фронте не подключен автоматически (только
  показывается текущий статус при загрузке страницы) — легко добавить
  `setInterval` на `GET /api/demos/:id` в `MatchDetailView.vue`.
#   r i f t  
 