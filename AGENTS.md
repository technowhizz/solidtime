# AGENTS.md

Operational notes for agents working in this repo. Everything here was learned the expensive way —
read it before exploring, and you'll skip a lot of dead ends.

## Stack in one breath

PHP **8.3.x** / Laravel 12, Inertia + Vue 3 (script setup, TS) + Tailwind **v3**. Auth is **Fortify**
(headless) + **Passport** (`api` guard). Postgres only — SQLite will not work, the app uses
`jsonb`, partial unique indexes and `date_bin()`. Frontend state: **TanStack Vue Query** for server
data, **Pinia** only where imperative create-from-anywhere is needed. npm workspaces:
`resources/js/packages/ui` (`@solidtime/ui`) and `resources/js/packages/api` (`@solidtime/api`).

`bootstrap/app.php` is the **legacy Laravel 10-style** bootstrap — providers in `config/app.php`,
middleware in `app/Http/Kernel.php`, schedule in `app/Console/Kernel.php`. Don't look for the L11+
slim skeleton.

## Getting a working environment

The repo's `docker-compose.yml` expects an **external traefik network** and `*.solidtime.test`
hostnames. If you don't already have that, don't fight it — run the toolchain directly.

You need PHP 8.3 with `pdo_pgsql`, `zip`, `gd`, `intl`, `bcmath`, `pcntl`, **and the `psql` client
binary** (`RefreshDatabase` shells out to it to load `database/schema/pgsql_test-schema.sql`; without
it every DB test dies with a `ProcessFailedException`). Node must be **20.19+** — Vite 7 refuses
older, and Node 18 is still common on hosts.

Services and why each is needed:

| Service | Needed for | Miss it and… |
|---|---|---|
| Postgres as host `pgsql` | dev DB | app won't boot |
| Postgres as host `pgsql_test` | `phpunit.xml` sets `DB_CONNECTION=pgsql_test` | all DB tests fail |
| `gotenberg:3000` | one PDF export test | `TimeEntryEndpointTest` export test 500s |
| `mailpit:1025` + `:8025` | e2e email verification tests | ~9 `profile.spec.ts` tests fail |

Then, in this order:

```bash
cp .env.example .env          # point DB_HOST/DB_TEST_HOST at your Postgres hosts
php artisan passport:keys     # else auth tests fail
php artisan migrate --force
php artisan db:seed --force   # creates the Passport personal access client the e2e ctx fixture needs
npm ci
npm run build                 # REQUIRED before PHP tests — see below
```

**`npm run build` is not optional before running PHP tests.** Any test that renders an Inertia page
(`DashboardEndpointTest`, etc.) hits `app.blade.php` → `@vite` → `ViteManifestNotFoundException` →
500. CI does this too (`.github/workflows/phpunit.yml` runs `npm run build` before `artisan test`).
It also means **rebuild after frontend edits** or the browser serves stale JS.

## Commands (these are exactly what CI runs)

```bash
composer fix          # pint: laravel preset + declare_strict_types, strict_comparison, void_return
composer analyse      # phpstan level 7, app/ only — tests are NOT analysed
composer test         # artisan test --stop-on-failure    (ptest = parallel)
npm run type-check    # vue-tsc --noEmit
npm run lint          # 83 pre-existing warnings, 0 errors — don't chase them
npm run format:check
npm run test:unit     # vitest
npm run test:e2e      # playwright
```

## Traps

**Do not regenerate the committed "generated" artifacts.** They are stale relative to the current
generators and are effectively hand-maintained:

| File | Why not |
|---|---|
| `resources/js/packages/api/src/openapi.json.client.ts` | Regenerating **deletes every Billing/Invoicing/Services endpoint**. Those extensions live in separate private repos and are absent here, but `packages/api/src/index.ts` still references their aliases (`getInvoice`, `getInvoices`, …), so a full regen breaks `type-check`. Add new endpoints by hand, in the generated style. |
| `openapi.json` | 914 lines vs ~9k if regenerated. CI exports to `build/api-docs.json`, **never** to this file. |
| `resources/js/types/models.ts` | Regenerating adds ~530 lines of unrelated models. Only `User`/`Organization` are actually imported. |

`npm run zod:generate` also requires the app served at `http://localhost:80`.

**Extensions are absent.** `config/modules.php` remaps modules to `Extensions`, and
`HandleInertiaRequests` probes for `Billing`/`Invoicing`/`Services`, but there is no `modules/`
directory. Build features in `app/`, not as an extension.

## Conventions the tooling enforces

- `declare(strict_types=1);` in **every** PHP file.
- **phpstan `checkModelProperties`** — every model needs an exhaustive `@property` docblock or
  analyse fails.
- **`noEnvCallsOutsideOfConfig`** — `env()` only in `config/*.php`; read via `config()` everywhere else.
- **`Model::preventLazyLoading()` is on outside production** — `$user->someRelation` throws. Use
  `$user->someRelation()->first()` in controllers.
- `Model::unguard()` is global, so `$fillable` is bypassed; models rely on `$casts`.
- UUID PKs everywhere: `$table->uuid('id')->primary()`, never `$table->id()`. FKs use
  `->restrictOnDelete()` — deletion is explicit in `app/Service/DeletionService.php`, so a new
  user-owned table must be cleaned up there or user deletion breaks.
- `tests/Unit/Database/MigrationTest.php` asserts `migrate:rollback` works — `down()` must really reverse.
- **No policies.** Authorization is `app/Service/PermissionStore.php` (hardcoded `ROLE_DEFINITIONS`);
  controllers call `$this->checkPermission($organization, 'time-entries:create:own')`. User-scoped,
  organization-independent endpoints (API tokens, integrations) do **no** permission checks.
- API errors extend `app/Exceptions/Api/ApiException.php` → renders **400** with `{error, key, message}`,
  message in `lang/en/exceptions.php`.
- Timestamps in API requests are strictly `date_format:Y-m-d\TH:i:s\Z` — UTC, no offsets.
- Scramble builds OpenAPI from **docblocks, not attributes**. `@operationId` becomes the TS client
  method name; resources need a per-field `/** @var type $name Description */`.

## Tests

**Layout inversion: API and web endpoint tests live in `tests/Unit/Endpoint/`, not `tests/Feature/`.**
`tests/Feature/` holds only the 9 Fortify auth-scaffolding tests.

- `Laravel\Passport\Passport::actingAs($user)` for API tests; `$this->actingAs($user)` for Web/Inertia.
- Literal `// Arrange` / `// Act` / `// Assert` blocks; methods named `test_<endpoint>_endpoint_<behaviour>`.
- `#[UsesClass]` on API endpoint tests, `#[CoversClass]` on Web/unit tests.
- `tests/TestCase.php` calls **`Http::preventStrayRequests()`** — every outbound call must be faked.
  Note Socialite uses its **own Guzzle client** and bypasses this entirely, so don't route testable
  outbound HTTP through it.
- Workhorse fixtures in `TestCaseWithDatabase`: `createUserWithPermission([...])`, `createUserWithRole(Role::X)`.
- Vitest has **`globals: false`** — import `describe`/`it`/`expect` from `vitest`. Tests are co-located.
- Playwright: `playwright/config.ts` reads `PLAYWRIGHT_BASE_URL` / `MAILPIT_BASE_URL`. Run with
  **`--workers=1`** locally; higher parallelism produces ~6 spurious failures on a loaded machine.

### There is no known-failing baseline — a red test is a real signal

An earlier version of this file listed four "always red locally" tests. That was wrong, and
treating them as expected noise hid a genuine product bug for several rounds. They are all fixed;
the suite should be green. If something is red, investigate it rather than assuming it is known.

Four failure modes cost real time before, so check for them first:

**Local time of day.** Several calendar tests build fixtures relative to `now`, and the grid only
renders the visible week. A running entry is created starting *10 minutes ago*, so just after
midnight it spans two days and is drawn as one clipped segment per day column — assertions that
count DOM elements then see two. Assert on distinct `data-event-id` values, not element counts.

**Which day ends the week.** The week starts **Monday** (`User` model defaults `week_start`), so
the last visible column is **Sunday**. Tests that need "today and tomorrow both visible" must skip
on Sunday, and tests that need the previous day must skip on Monday. Guarding Saturday is the
Sunday-start assumption and is wrong here — it silently fails one day in seven.

**A Playwright timeout here usually means a hang, not slowness.** The helpers in
`e2e/utils/currentTimeEntry.ts` wait for a response matching a *specific payload* — a particular
description, type and tag set. If the app sends the request with anything else, nothing ever
matches and the test sits until its ceiling, reporting a bare timeout with no hint at the cause.
Resist raising the timeout: `breaks.spec.ts` already had 60s via `test.describe.configure` and
still stalled, because nothing was ever going to arrive. Find out what the app actually sent.

The usual cause is interacting before the UI is ready. Two guards, both already the convention in
the passing tests: `await expect(field).toBeEditable()` before typing, and after dismissing a
reka-ui dropdown with Escape, wait for one of its items to reach `toHaveCount(0)` — the layer
tears down asynchronously and owns focus until it has, so typing underneath it can be swallowed.

**`scrollIntoViewIfNeeded` parks an element against the bottom edge**, because it stops the moment
the element is visible. Any test that then clicks at a fixed offset *below* it — to hit an empty
calendar slot next to an entry — clicks outside the viewport, hits nothing, and fails as an
unexplained `getByRole('menu')` timeout. Two specs did exactly this. Use
`scrollIntoViewCentred()` from `e2e/utils/scroll.ts`, which centres the element so there is room
on both sides, and assert the click point is inside `page.viewportSize()` so a regression says so
instead of timing out. Whether it bites depends on the calendar's scroll position, so it looks
like flakiness — the same run can fail a different test each time.

## The calendar (`resources/js/packages/ui/src/FullCalendar/`)

The biggest and most-edited subsystem. It is **hand-rolled** — despite the directory name there is no
`fullcalendar` npm dependency.

- **`packages/ui` is provider-agnostic.** It imports *types* from `@/packages/api/src` but never calls
  `api` directly, and knows nothing about Google/Outlook/etc. Map provider-specific shapes in the page
  (`resources/js/Pages/Calendar.vue`) before passing them down.
- **`eventLayout.ts`** holds the shared day-clipping and overlap-column algorithm, generic over
  `{ dayStart: Dayjs; dayEnd: Dayjs }`. Reuse it for any new overlay lane rather than reimplementing.
- **There is no `SLOT_HEIGHT` constant** — the grid is zoomable. Use `slotHeight` from
  `useCalendarGrid`, or `minutesToPixelsFor` / `pixelsToMinutesFor` / `slotHeightFor` from
  `calendarSettings.ts`. `CalendarSettings` includes a **required `pixelsPerHour`**, so any test
  building one as an object literal must set it (`DEFAULT_PIXELS_PER_HOUR`).
- Day columns compose lanes via **one computed inline style** (`left` from the activity gutter,
  `right` from the external-calendar lane) — add new lanes there, not as more CSS classes.
- `TimeEntryCalendar.vue` is the orchestrator and is where parallel work collides most often.
- Provider-specific UI goes in a **named slot**, not in the package: `toolbar-actions` and
  `calendar-settings` are forwarded down to `CalendarToolbar` and `CalendarSettingsPopover` so the
  page can inject a Jira button and a Jira checkbox without the package knowing they exist.

## Integrations (`app/Service/GoogleCalendar/`, `app/Service/Jira/`)

Both follow the same shape: a `*Config` that decides whether the integration is switched on at all,
a per-user connection model with credentials cast `'encrypted'` and **deliberately not auditable**
(audit rows would copy the tokens), a card under `Profile/Partials/`, and a boolean in
`HandleInertiaRequests::share()` that every user-facing entry point gates on.

They differ in one way worth knowing: **Google is switched on per installation** (`GOOGLE_CLIENT_ID`
in `config/services.php`), **Jira is switched on per organization** (`organizations.jira_site_url`,
set by an admin). So `jira_enabled` depends on the current organization, and a `JiraConnection` is
unique per `(user, organization)` — someone in two organizations with two Jira sites holds two.

Jira specifics:

- **`JiraClient` is built on the `Http` facade, not its own Guzzle client**, precisely so
  `Http::preventStrayRequests()` covers it. Do not copy Socialite's approach here.
- Worklogs are **reconciled, not journalled.** `JiraSyncService::plan()` recomputes the desired
  worklogs from the entries and diffs them against the `jira_worklogs` rows, producing
  create/update/delete/unchanged. There is deliberately **no pivot to `time_entries`**: group
  membership is derived from a `group_hash` of issue key + local date + comment, so an edited
  description simply moves an entry to a different group and time entry deletion needs no cascade.
- Everything is keyed on the user's **local** day, not the UTC one, and worklog `started` carries
  the user's real offset. Both are easy to get wrong and produce work logged on the wrong day.
- `jira_connections.sync_from_date` is a cutoff: work before it is treated as already logged, which
  is what stops imported Toggl/Clockify history being sent again. Worklogs from before it are also
  excluded from reconciliation, so moving the cutoff forward cannot delete real ones.
- **Anything derivable from a time entry is derived on the client, not fetched.** The "no ticket"
  dot used to come from `/jira/sync-status`, so a newly created entry showed no dot until that
  query happened to refetch — in practice, not until the page was reloaded. It is now computed by
  `missingReferenceBadges()` from the entry list the page already renders, which makes it correct
  the instant anything changes and costs no request at all. Only synced/pending/outdated still come
  from the server, and `useTimeEntriesMutations` invalidates `['jira', 'syncStatus']` so those stay
  fresh too. `e2e/jira.spec.ts` has two tests that never reload and will fail if this regresses.
- The issue-key regex is duplicated in `utils/jira.ts` so the edit dialog can show the ticket as you
  type. `jira.test.ts` mirrors `JiraIssueKeyParserTest` case for case — if one side changes, the
  other fails.

## Contributing upstream

`CONTRIBUTING.md`: feature requests go in Discussions, only approved issues get worked, and PRs from
non-vouched authors are **auto-closed above 50 changed lines** (tests and lockfiles excluded). A CLA
is required. Run `composer fix && composer analyse` and `npm run lint:fix && npm run format` before
committing.
