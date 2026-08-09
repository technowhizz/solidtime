# Handoff: Google Calendar integration for solidtime

This document is a complete, self-contained brief for implementing Google Calendar integration in
solidtime. It was produced on a machine with no PHP/Composer/Docker toolchain, so **the plan is
researched and approved but no code has been written and nothing has been verified by running it.**

Hand this file to Claude Code on a machine that can build and test the project. A good opening
prompt there:

> Read `handoff.md` at the repo root. It contains an approved implementation plan for Google Calendar
> integration plus everything already learnt about this codebase. Implement it. Don't re-explore what
> the doc already establishes — but do verify any claim marked "UNVERIFIED" before relying on it.

Delete this file before opening a PR — it is scaffolding, not documentation.

---

## 1. The task

Add Google Calendar integration to solidtime, modelled on Clockify's: link your Google account, see
your calendar events in the time-tracking week view, and copy an event into a time entry with one
click, using the event title as the work-log description. Requirement from the user: **minimal Google
permissions**.

This is a long-standing community request —
[solidtime discussion #358](https://github.com/solidtime-io/solidtime/discussions/358). A community
member reports having built it in a fork using Socialite, which corroborates the approach below. It
is not implemented upstream.

### Why the groundwork is favourable

- `/calendar` already renders a real time grid — hand-rolled, in
  `resources/js/packages/ui/src/FullCalendar/` (**not** the FullCalendar npm package, despite the
  directory name; there is no `fullcalendar` dependency anywhere).
- That grid already has a **read-only, non-TimeEntry overlay lane**: the desktop app's
  `ActivityPeriod` boxes (`useActivityBoxes.ts` → `CalendarDayColumn.vue:143-224`), which reserve a
  gutter and inset the time entries. Google events reuse that exact idiom.
- "Copy as time entry" is mechanically the existing right-click **Duplicate**
  (`useContextMenu.ts:70-84`) with a different description/start/end.

### Decisions — confirmed with the user, do not relitigate

| | |
|---|---|
| **OAuth library** | `laravel/socialite` for the authorization-code flow; plain `Http` calls for the Calendar REST API. **Not** `google/apiclient` (~100 transitive packages for one GET). **Not** `spatie/laravel-google-calendar` — it is built for a single app-owned service-account calendar configured from files, not per-user OAuth with tokens in the DB. Socialite is first-party, is the de-facto standard, and ships `Socialite::fake()` for tests. |
| **Scopes** | `https://www.googleapis.com/auth/calendar.events.readonly` + `https://www.googleapis.com/auth/userinfo.email`. Read-only, events only — no write, no calendar list, no `profile`. The email scope exists so the settings card can show *which* account is linked; without it a user who connects the wrong Google account has no way to tell. |
| **Data at rest** | Only OAuth tokens, encrypted. Event content is proxied live per request with a 60s cache — no meeting titles in solidtime's database. |
| **Rendering** | Google events get their own lane on the **right** of each day column; time entries inset from the right. The existing activity-status gutter stays on the left, so the two lanes bracket the time entries rather than competing. |
| **Copy action** | Click creates the entry immediately; right-click offers "Copy and edit…" which opens the prefilled create modal for picking a project/task. |

Scope alternatives that were considered and rejected: `calendar.events.readonly` alone (no way to
show account identity), and `calendar.events.owned.readonly` (narrower, but its behaviour for
meetings you were invited to by others is poorly documented — those may not appear even though they
sit on your primary calendar).

---

## 2. Environment prerequisites

The planning machine had **no** `php`, `composer`, `docker`, `vendor/`, or `node_modules/`. Only
`node`/`npm` via Homebrew. Before implementing, on the dev machine confirm:

```bash
php -v            # must be 8.3.x — composer.json pins "php": "8.3.*"
composer -V
docker compose version
```

Then the usual bring-up (`docker-compose.yml`, `.env.example` → `.env`; Postgres is required — tests
run against a `pgsql_test` connection, and the app uses Postgres-only features so SQLite is not an
option). `php artisan passport:keys` is needed too — the CI workflow runs it before tests.

---

## 3. Repo knowledge (verified during exploration)

### 3.1 Stack

**Backend.** PHP `8.3.*`, Laravel `^12.19.3`, Inertia + Ziggy. Auth is **Fortify** (headless
login/register/2FA) + **Passport** (the `api` guard, and user-facing API tokens). **No Jetstream, no
Sanctum, no Socialite, no `google/apiclient` — there is no OAuth *client* library in the repo at
all.** `league/oauth2-server` is present only as a Passport transitive dep (that's an OAuth
*server*). Other notable deps: `filament/filament` (admin panel), `dedoc/scramble` (OpenAPI from
docblocks), `nwidart/laravel-modules` (namespace remapped to `Extensions`), `owen-it/laravel-auditing`,
`tpetry/laravel-postgresql-enhanced`, `guzzlehttp/guzzle`, `laravel/octane`.

Note `bootstrap/app.php` is the **legacy Laravel 10-style** bootstrap (explicit `App\Http\Kernel`,
`App\Console\Kernel`, `App\Exceptions\Handler`), not the L11/12 slim skeleton. Providers are in
`config/app.php`, middleware in `app/Http/Kernel.php`, schedule in `app/Console/Kernel.php`.

**Frontend.** Vue `^3.5.34` (script setup + TS), Inertia `^2.3.23`, Tailwind **v3**, **Pinia** *and*
**TanStack Vue Query** (server data → Vue Query; imperative cross-component state → Pinia),
**dayjs** only for dates, **reka-ui** (+ legacy `radix-vue`) for primitives, `chroma-js`,
`@tanstack/vue-table`/`-virtual`/`-form`, `zod` + `@zodios/core`. npm workspaces:
`resources/js/packages/ui` (`@solidtime/ui`) and `resources/js/packages/api` (`@solidtime/api`).

Icons: `@heroicons/vue` (~127 imports, dominant — sub-path picks size/style, `@heroicons/vue/20/solid`
is the default choice) and `@lucide/vue` (~42 imports, for what heroicons lacks). Custom SVGs live in
`resources/js/packages/ui/src/Icons/`. **Neither library ships a Google glyph.**

### 3.2 Backend architecture

`app/` namespaces: `Actions/Fortify`, `Console/Commands/<Domain>`, `Enums`, `Events`, `Exceptions/Api`,
`Extensions` (vendor-behaviour overrides for Fortify/Scramble/Auditing), `Filament/Resources`,
`Http/Controllers/Api/V1` + `Http/Controllers/Web`, `Http/Requests/V1/<Domain>`,
`Http/Resources/V1/<Domain>`, `Http/Middleware`, `Jobs`, `Mail`, `Models` (flat, + `Models/Concerns`,
`Models/Passport`), `Providers`, `Rules`, `Service`, `Support`.

Conventions that matter here:

- **`app/Service/` is the business-logic layer** — plain classes, interface only when swappable.
- **Optional external integrations use Contract + null-object binding.**
  `app/Service/IpLookup/` (`IpLookupServiceContract`, `NoIpLookupService`, `IpLookupResponseDto`) is
  the canonical template, bound in `app/Providers/AppServiceProvider.php`. The real implementation
  lives outside the repo. `app/Service/BillingContract.php` does the same.
- **Web vs API split.** `Web/*` controllers only `Inertia::render(...)`; many web routes are inline
  closures. All data flows through `/api/v1/*`, consumed by the generated TS client.
- `Model::unguard()` is called globally in `AppServiceProvider::boot()` — `$fillable` is effectively
  bypassed; models rely on `$casts` and explicit assignment. `preventLazyLoading`,
  `preventSilentlyDiscardingAttributes`, `preventAccessingMissingAttributes` are on outside production.
- `Relation::enforceMorphMap([...])` in `AppServiceProvider` — any model in a polymorphic/audit
  relation must be registered there.
- `declare(strict_types=1);` in every PHP file.

**Permissions.** There are **no policies** (`app/Policies/` does not exist; `AuthServiceProvider`
has `$policies = []`). Authorization is `app/Service/PermissionStore.php`: a hardcoded
`ROLE_DEFINITIONS` const mapping 5 roles (`owner`/`admin`/`manager`/`employee`/`placeholder`, enum
`app/Enums/Role.php`) to flat arrays of raw permission strings like `time-entries:create:own`. No
enum for permissions. Controllers call `$this->checkPermission($organization, '...')` from
`app/Http/Controllers/Api/V1/Controller.php`; resource controllers override it with an extra tenancy
guard; the `own` vs `all` decision is made inline per action. `PermissionStore` is a **scoped
singleton** with per-`"$userId|$orgId"` memoization, plus `registerCustomRole()`/`resetCustomRoles()`
static test hooks.

**This feature needs no permission entries** — the Google connection is per-user and
organization-independent, exactly like `app/Http/Controllers/Api/V1/ApiTokenController.php`, which
performs no permission checks at all.

**Migrations** (`database/migrations/`, 61 files). UUID PKs everywhere:
`$table->uuid('id')->primary();`, never `$table->id()`. Model side uses `App\Models\Concerns\HasUuids`
(wraps Laravel's trait, overrides `newUniqueId()` to return `Ramsey\Uuid\Uuid::uuid4()`). FKs written
long-form with `->cascadeOnUpdate()` and **`->restrictOnDelete()`** — deletion is done explicitly in
`DeletionService`, not by the DB. Anonymous class migrations, typed `: void` closures. Postgres
features used freely (`jsonb`, partial unique indexes, `date_bin()`). Newer migrations are hand-dated
with sequential suffixes (`2026_07_13_000001_...`). Column adds use `->after('...')`. **`down()` must
really reverse** — `tests/Unit/Database/MigrationTest.php` asserts `migrate:rollback` succeeds.

Best template for a new table: `database/migrations/2024_08_01_104840_create_reports_table.php`
(uuid pk + jsonb + restricted FK).

**No encryption-at-rest pattern exists yet.** Grepping `app/` for `'encrypted'` casts, `Crypt::`, or
`encryptString` returns nothing. Storing Google refresh tokens introduces the first one.

**Outbound HTTP.** Almost no precedent: `grep -rn "Http::" app/` returns exactly two hits, both in
`app/Service/ApiService.php` (solidtime's own version-check/telemetry phone-home). The house pattern:

```php
private const string API_URL = 'https://app.solidtime.io/api/v1';

$response = Http::asJson()->timeout(3)->connectTimeout(2)->post(self::API_URL.'/ping/version', [...]);
if ($response->status() === 200 && isset($response->json()['version'])) { ... }
// wrapped in try/catch (\Throwable) -> Log::warning -> null
```

There is no generic HTTP wrapper, no retry/backoff helper, no token-refresh infrastructure, and no
`Http::withToken(...)` usage anywhere.

**Queues.** Default driver is **`sync`** (`config/queue.php`, and `.env.example` sets
`QUEUE_CONNECTION=sync`) — a self-hosted install may execute "queued" work inline in the web request.
Existing jobs (`app/Jobs/RecalculateSpentTimeFor{Project,Task}.php`) already accept this. Scheduler
tasks in `app/Console/Kernel.php::schedule()` are each guarded by a `config('scheduling.tasks.*')`
env flag — that's the house style for operator-toggleable features. No websockets/Reverb, so nothing
can be pushed to the UI.

**Config.** `config/services.php` is almost empty — Laravel's default third-party block was stripped,
leaving only:

```php
return [
    'gotenberg' => [
        'url' => env('GOTENBERG_URL'),
        'basic_auth_username' => env('GOTENBERG_BASIC_AUTH_USERNAME'),
        'basic_auth_password' => env('GOTENBERG_BASIC_AUTH_PASSWORD'),
    ],
];
```

**Inertia shared props.** `app/Http/Middleware/HandleInertiaRequests.php` shares
`has_billing_extension` / `has_invoicing_extension` / `has_services_extension`, `billing`, `flash`
(with `message`, `bannerText`, `bannerStyle`). `app/Http/Middleware/ShareInertiaData.php` shares
`auth.user` / `auth.permissions`. **Crucially, `app/Http/Kernel.php`'s `web` group ends with
`Laravel\Passport\Http\Middleware\CreateFreshApiToken` — so the browser can call `/api/v1/*`
authenticated from the session cookie.** That's why the SPA works without explicit tokens.

**Extensions.** `config/modules.php` remaps the module namespace to `Extensions`, and
`HandleInertiaRequests` probes for `Billing`/`Invoicing`/`Services` — but there is **no `modules/`
directory** in this checkout and `extensions/` holds only `.gitkeep`, `extensions_autoload.php`, and
a `manifest.json` pointing at three separate private repos. The module path is untested and
unpopulated in open source, so **build this in `app/`, not as an extension.**

### 3.3 TimeEntry creation path

`app/Models/TimeEntry.php` — traits `ComputedAttributes`, `CustomAuditable`, `HasFactory`,
`HasJsonRelationships`, `HasUuids`. `type` casts to `App\Enums\TimeEntryType` (`work`|`break`),
`tags` is a jsonb array. A running entry has `end === null`. A `saving` hook nulls
project/task/client/tags and forces `billable = false` for breaks.

`app/Http/Controllers/Api/V1/TimeEntryController.php::store()` (line 586) is the creation sequence.
Two rules are enforced **in the controller, not a service**: only one running entry per member, and
`assertNoOverlap()` (line 63, gated on `$organization->prevent_overlapping_time_entries`). There is
no `TimeEntryService::create()`. **Consequence: the copy-to-time-entry action must go through the
existing HTTP endpoint (which it does — see §5.4), not construct entries server-side.**

Timestamps must be **exactly** `date_format:Y-m-d\TH:i:s\Z` — UTC, no offsets, no fractional
seconds. Google returns RFC3339 *with* offsets, so conversion is required.

### 3.4 Frontend: the calendar grid

Page `resources/js/Pages/Calendar.vue` (146 lines, route `/calendar`, `routes/web.php:45`). It is thin
by design: wires queries/mutations/permissions and passes plain data + callback props into the
presentational `TimeEntryCalendar` in `packages/ui`. `packages/ui` imports *types* from
`@/packages/api/src` but never calls `api` directly — **keep it that way.**

`resources/js/packages/ui/src/FullCalendar/`:

| File | Lines | Role |
|---|---|---|
| `TimeEntryCalendar.vue` | 827 | Orchestrator; all props/composables/context menu |
| `CalendarDayColumn.vue` | 430 | One day column: events, activity overlays, now-line, selection |
| `useCalendarGrid.ts` | 137 | Slots, `minutesToPixels`, snapping, `getDayFromClientX` |
| `useCalendarEvents.ts` | 325 | TimeEntry → `CalendarEvent`, overlap column layout, daily totals |
| `useActivityBoxes.ts` | 107 | Read-only overlay boxes |
| `useCalendarNavigation.ts` | 109 | `timeGridWeek`/`timeGridDay`, `viewDays`, prev/next/today |
| `useEventDrag.ts` / `useEventResize.ts` / `useSlotSelection.ts` | 294/358/195 | Pointer interactions |
| `useContextMenu.ts` | 214 | Right-click: Edit / Duplicate / Split / Delete / Create |
| `CalendarToolbar.vue`, `CalendarSettingsPopover.vue`, `FullCalendarDayHeader.vue`, `FullCalendarEventContent.vue` | | Chrome |
| `calendarTypes.ts`, `calendarSettings.ts`, `activityTypes.ts` | 42/6/13 | Types/constants |

**Grid mechanics.** Sticky header row (`TIME_AXIS_WIDTH = 48` px spacer + CSS grid
`repeat(viewDays.length, 1fr)`), then a scroller containing a fixed time-axis column and a second
grid of the same column count. Positioning is absolute pixels: `SLOT_HEIGHT = 25`,
`minutesToPixels(m) = (m / slotMinutes) * SLOT_HEIGHT`. Overlapping events get greedy column
assignment (`assignColumns` → `groupOverlappingEvents`) yielding
`left: "${col/totalCols*100}%"` / `width`. Settings persist via
`useLocalStorage('solidtime:calendar-settings', { snapMinutes: 15, startHour: 0, endHour: 24, slotMinutes: 15 })`.

**The overlay-lane precedent — read this before touching the grid.** `activityTypes.ts`:

```ts
export interface WindowActivityInPeriod { appName: string; label: string | null; count: number; icon?: string | null }
export interface ActivityPeriod { start: string; end: string; isIdle: boolean; windowActivities?: WindowActivityInPeriod[] }
```

`useActivityBoxes` clips each period per day and per visible hour range into
`ActivityBox { dateStr, top, height, isIdle, period }`. `CalendarDayColumn.vue:143-224` renders them
as tooltip-wrapped absolutely-positioned boxes in a **left** gutter (`.activity-status-box`,
`width: 10px`, `left: 0`), widening to `200px` in day view, pushing events right via
`.fc-events-inset { left: 8px }` / `.fc-events-inset-expanded { left: 204px }` (lines 412-418).
`isUncoveredByEvents()` (line 51) makes uncovered boxes fill the column width in week view.

`Calendar.vue:142` passes `:activity-periods="testActivityPeriods"` — **currently fed only by
`window.__TEST_SET_ACTIVITY_PERIODS__` E2E hooks** (`Calendar.vue:37-55`). There is no server source
for it. Google events would be the first real one.

**Also relevant:** `resources/js/Pages/Timesheet.vue` + `resources/js/Components/Timesheet/` is a
second week-style view (rows = project/task, columns = 7 days, duration-per-cell). Not a time grid,
out of scope — though `resources/js/utils/timesheet/useCopyLastWeek.ts` is a reference for bulk entry
creation.

### 3.5 Frontend: API client and data layer

**Generated Zodios client, not hand-written.**

- Generated: `resources/js/packages/api/src/openapi.json.client.ts` (5001 lines, committed).
- Command: `npm run zod:generate` →
  `npx openapi-zod-client http://localhost:80/docs/api.json --output resources/js/packages/api/src/openapi.json.client.ts --base-url /api`
  — **requires the app running locally** serving Scramble's `/docs/api.json`.
- Hand-maintained type façade: `resources/js/packages/api/src/index.ts` (135 lines):

```ts
export type TimeEntry = ZodiosResponseByAlias<SolidTimeApi, 'getTimeEntries'>['data'][0];
export type CreateTimeEntryBody = ZodiosBodyByAlias<SolidTimeApi, 'createTimeEntry'>;
const api = createApiClient('/api', { validate: 'none' });
```

The alias comes from the controller's `@operationId` docblock, so that tag determines the TS method name.

**Query pattern** — `resources/js/utils/useTimeEntriesCalendarQuery.ts` is the closest model:
exported `createCalendarQueryKey()`, `fetchAllCalendarEntries()` (loops pagination),
`getExpandedCalendarDateRange()` (pre-loads prev+next period so navigation doesn't flash), `useQuery`
with `enabled`, `placeholderData: (prev) => prev`, `staleTime: 30_000`.

**Mutation pattern** — `resources/js/utils/useTimeEntriesMutations.ts`: `useMutation` +
`handleApiRequestNotifications(fn, successMsg, errorMsg)` from `useNotificationsStore`, then
`onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timeEntries'] })`. **`createTimeEntry`
already injects `member_id` from `getCurrentMembershipId()`** — callers pass
`Omit<CreateTimeEntryBody, 'member_id'>`.

There is **no Pinia store for time entries** — they are pure Vue Query. Stores
(`useTags.ts`, `useProjects.ts`, `useClients.ts`, `useCurrentTimeEntry.ts`) exist only where
imperative create-from-anywhere is needed. Organization is provided by `AppLayout` and consumed with
`inject<ComputedRef<Organization>>('organization')`. Route prefetch-on-hover map:
`resources/js/utils/prefetch.ts` (`/calendar` at line 40).

### 3.6 Frontend: settings pages and components

`resources/js/Pages/Profile/Show.vue` (route `profile.show`, `routes/web.php:106`,
`UserProfileController@show`) is a flat stack of partials from `Profile/Partials/`
(`UpdateProfileInformationForm`, `ThemeForm`, `UpdatePasswordForm`, `TwoFactorAuthenticationForm`,
`LogoutOtherBrowserSessionsForm`, `ApiTokensForm`, `DeleteUserForm`) separated by `<SectionBorder />`.
Adding a partial is a one-line change.

Card scaffolding in `resources/js/Components/`: `FormSection.vue` (`md:grid-cols-3`; `#title`/
`#description` in `SectionTitle`, `#form` slot, optional `#actions`), `ActionSection.vue` (same
layout, `#content` instead of a form), `SectionTitle.vue` (has an `#aside` slot — good for a status
`Badge`), `SectionBorder.vue`, `ActionMessage.vue`, `ConfirmationModal.vue`.

**`ApiTokensForm.vue` is the model to mirror** — a user-scoped, organization-independent credential
list rendered as a profile section, combining `FormSection` + `ActionSection` + `DialogModal` +
`ConfirmationModal` + `useQuery`/`useMutation`/`handleApiRequestNotifications`, with data over
`/api/v1/users/me/...` rather than Inertia props. Simplest model: `ThemeForm.vue`.

`packages/ui/src/` barrel is `index.ts` (286 lines); import from `@/packages/ui/src`. Notables:
`Button.vue` (CVA variants incl. `outline`, sizes `xs`/`sm`), `PrimaryButton`/`SecondaryButton`/
`DangerButton`, `Badge`, `LoadingSpinner`, `Modal`/`DialogModal` + reka `dialog/`, `dropdown-menu/`,
`context-menu/`, `select/`, `popover/`, `tooltip/`, the `field/` set, `DatePicker`/`DateRangePicker`,
`utils/cn.ts` (clsx + tailwind-merge), `utils/time.ts` (`getLocalizedDayJs`,
`getLocalizedDayJsFromMinutes`, `getDayJsInstance`, `formatHumanReadableDuration`, `localDateToUtc`).

Sidebar nav lives in `resources/js/Layouts/AppLayout.vue` (Calendar at lines 184-188, "Profile
Settings" at 302-308) using `NavigationSidebarItem` with Ziggy `route()`/`route().current()`.

### 3.7 Tests and CI

**PHPUnit, not Pest** (the `pestphp/pest-plugin` entry in `allow-plugins` is vestigial — no Pest
dependency exists). 128 PHP test files. `phpunit.xml` defines three suites: `Unit`, `Feature`, and
`Modules` (`./extensions/*/tests/{Feature,Unit}`). Test env: `DB_CONNECTION=pgsql_test`,
`QUEUE_CONNECTION=sync`, `AUDITING_ENABLED=true`, `MAIL_MAILER=array`.

**Important layout inversion: API/web endpoint tests live under `tests/Unit/Endpoint/`, not
`tests/Feature/`.** `tests/Feature/` holds only the 9 Fortify auth-scaffolding tests.

```
tests/
  TestCase.php   TestCaseWithDatabase.php   CreatesApplication.php
  Feature/                                    (auth scaffolding only)
  Unit/
    Endpoint/Api/V1/   ApiEndpointTestAbstract.php + 21 *EndpointTest.php
    Endpoint/Web/      EndpointTestAbstract.php + Dashboard, User, UserProfile, ...
    Console/  Database/  Filament/  Jobs/  Mail/  Middleware/  Model/  Rules/  Service/
```

- `tests/TestCase.php` — `setUp()` calls `Mail::fake()`, `LogFake::bind()`, and
  **`Http::preventStrayRequests()`** (any un-faked outbound HTTP throws — every Google call must be
  faked), and by default `actAsOrganizationWithoutSubscriptionAndWithoutTrial()` (mocks
  `BillingContract`; opt out with `protected bool $mockBillingContract = false;`). `tearDown()` clears
  the scoped `PermissionStore` and calls `PermissionStore::resetCustomRoles()`. Helpers:
  `mockPrivateStorage()`, `mockPublicStorage()`, a `travelTo()` override forcing `->utc()`,
  `assertEqualsIdsOfEloquentCollection()`.
- `tests/TestCaseWithDatabase.php` — `RefreshDatabase`, plus the two workhorse fixtures:
  `createUserWithPermission(array $permissions = [], bool $isOwner = false)` (registers an ad-hoc
  role via `PermissionStore::registerCustomRole`, returns
  `(object) ['user','organization','member','owner','ownerMember']`) and
  `createUserWithRole(Role $role, bool $employeesCanSeeBillableRates = false)`. Also
  `enableQueryLog()`/`getQueryLog()`/`assertQueryCount()`.
- `tests/Unit/Endpoint/Api/V1/ApiEndpointTestAbstract.php` adds only `assertResponseCode()`, which
  `dump()`s the body on mismatch — that's why API tests use it over `assertOk()`.

**Hard conventions**, visible throughout `tests/Unit/Endpoint/Api/V1/TimeEntryEndpointTest.php`
(5421 lines, the canonical example):

- `Laravel\Passport\Passport::actingAs($user)` for API tests; `$this->actingAs($user)` only for
  Web/Inertia tests.
- Literal `// Arrange` / `// Act` / `// Assert` comment blocks in every test.
- Method names `test_<endpoint>_endpoint_<behaviour>`, real methods, no `#[Test]`.
- Every endpoint gets a negative permission test first (`createUserWithPermission()` with no
  permissions → `assertForbidden()`).
- Named routes always: `route('api.v1.time-entries.index', [...])`.
- `#[UsesClass(...)]` on API endpoint tests; `#[CoversClass(...)]` on Web/unit tests;
  `#[DataProvider]` for role matrices.
- Web/Inertia tests use `Inertia\Testing\AssertableInertia as Assert` with
  `->component()`, `->where()`, `->has()`, `->missing()`; unauthorized cases
  `assertRedirect(route('dashboard'))` rather than 403.
- API-exception responses assert `assertStatus(400)` + `assertJsonPath('error', true)`.
- `Http::fake()` idiom to copy:
  `tests/Unit/Console/Commands/SelfHost/SelfHostCheckForUpdateCommandTest.php` (URL-keyed fakes plus
  a case throwing `ConnectionException`).

**Factories** (`database/factories/`) are annotated `/** @extends Factory<Model> */`, states return
`static`/`self`, naming is `forX(Model $x)` for FK association / `withX()` for enrichment /
predicates like `active()`. `UserFactory` seeds `email_verified_at => now()`, a fixed bcrypt hash for
the literal password `password`, `timezone => 'Europe/Vienna'`, `week_start => Weekday::Monday`; its
`withPersonalOrganization()` state creates an org and attaches the user as `Role::Owner`.
`TimeEntryFactory`'s preferred association state is `forMember()` (sets `member_id` + `user_id` +
`organization_id` together — `forUser()` is `@deprecated`).

**Frontend tests.** Vitest (`vitest.config.ts`: `happy-dom`, **`globals: false`** so import
`describe`/`it`/`expect` from `vitest`, `include: resources/js/**/*.{test,spec}.ts`, setup
`resources/js/test-setup.ts` which stubs `window.getTimezoneSetting`/`getWeekStartSetting`/
`getNumberFormat`/`getIntervalFormat` and fakes `offsetWidth/Height` for TanStack Virtual). Tests are
**co-located** next to source; there are 13. `packages/ui/src/FullCalendar/useContextMenu.test.ts` is
the direct template for testing a calendar composable — it calls the composable with stubbed geometry
functions (`pixelsToMinutesFromMidnight: () => 0`) and a faked `MouseEvent` whose `target.closest()`
returns `{ getAttribute: () => id }`.

Playwright (`playwright.config.ts`: `testDir: ./e2e`, chromium locally + firefox on CI, 20s timeout;
`npm run test:e2e`). `e2e/calendar.spec.ts` is 2928 lines and is the reference for grid interaction:
`.fc` / `.fc-event` / `.fc-timegrid-slot-lane[data-time]` / `.fc-timegrid-col[data-date]` selectors,
helpers `goToCalendar`, `scrollCalendarToTime`, `getSlotHeight`, `openContextMenu`, and assertions
that wait on `page.waitForResponse` for the `/time-entries` call. Its "Activity Plugin Overlays"
section (~line 2200) shows the overlay idiom:
`page.evaluate(() => window.__TEST_SET_ACTIVITY_PERIODS__([...]))` then assert on
`.activity-status-box.active`/`.idle`. `data-testid`s in use: `calendar_view`, `calendar-title`,
`day_duration_summary`, `timesheet_view`, `time_view`. API fixtures in `e2e/utils/api.ts`;
auth/context fixtures in `playwright/fixtures.ts` (`ctx`, `employee`).

**Static analysis & CI.** `phpstan.neon`: larastan, `paths: [app/]` (**tests are not analysed**),
**`level: 7`**, `checkOctaneCompatibility: true`, **`checkModelProperties: true`** (this is why every
model carries an exhaustive `@property` docblock), `noEnvCallsOutsideOfConfig: true`. `pint.json`:
`laravel` preset + `declare_strict_types`, `strict_comparison`, `strict_param`, `no_unused_imports`,
`void_return`.

17 GitHub workflows; the check commands are: `php artisan test --stop-on-failure --coverage-text`
(matrix Postgres 15/16/17, needs `npm run build` + `php artisan passport:keys`), `composer analyse`,
pint, `npm run lint`, `npm run format:check`, `npm run type-check`, `npm run test:unit`,
`npx playwright test` (sharded, against `php artisan octane:start --server=frankenphp` on :8000),
and on `main` `php artisan scramble:export`.

**Scramble** (`config/scramble.php`, `api_path => 'api'`, docs at `/docs/api` and `/docs/api.json`,
middleware `['web', RestrictedDocsAccess::class]`) generates OpenAPI from **docblocks, not
attributes**. `app/Providers/AppServiceProvider.php:82` adds an OAuth2 security scheme via
`Scramble::extendOpenApi`. Two custom extensions in `app/Extensions/Scramble/`:
`ApiExceptionTypeToSchema` (maps `@throws SomeApiException` to a documented 400 with
`{error, key, message}`) and `PaginatedResourceCollectionTypeToSchema`. A committed snapshot lives at
`openapi.json`.

The annotation contract — first docblock line is the summary, following paragraph the description,
`@return` for the resource generic, `@throws` for error responses, `@operationId` for the SDK method
name:

```php
/**
 * Get time entries in organization
 *
 * If you only need time entries for a specific user, you can filter by `member_id`.
 *
 * @return TimeEntryCollection<TimeEntryResource>
 *
 * @throws AuthorizationException
 *
 * @operationId getTimeEntries
 */
public function index(Organization $organization, TimeEntryIndexRequest $request): JsonResource
```

Resources extend `app/Http/Resources/V1/BaseResource.php` (`formatDateTime()` →
`toIso8601ZuluString()`, `formatDate()` → `Y-m-d`) and precede **every** array key with an inline
`/** @var type $name Description */`. Requests extend `app/Http/Requests/V1/BaseFormRequest.php`;
each rule key is preceded by a `// Description` comment that Scramble lifts into the parameter
description; bound models are declared via a class-level `@property` docblock. Errors extend
`app/Exceptions/Api/ApiException.php` (abstract, `public const string KEY`, renders **400** with
`{error: true, key, message: __('exceptions.api.'.$key)}`); 22 concrete subclasses exist, each with a
message in `lang/en/exceptions.php` under the `'api'` key.

**Routes.** `app/Providers/RouteServiceProvider.php` (classic pre-11 style) registers
`Route::middleware('api')->prefix('api')->name('api.')->group(routes/api.php)` then
`Route::middleware('web')->group(routes/web.php)`. So URLs are `/api/v1/...` and names are
`api.v1.<group>.<action>`. `routes/api.php` = outer `Route::prefix('v1')->name('v1.')`, then an inner
`['auth:api','verified']` group of per-resource groups; closures are all
`static function (): void`. Rate limit: 200/min per user, 60/min per IP, production only. The `api`
middleware group is `throttle:api`, `SubstituteBindings`, `ForceJsonResponse`. `routes/web.php` is
mostly `Inertia::render('Page')` closures inside `['auth:web','auth.session','verified']`.
Model-binding aliases are declared in `AppServiceProvider` (`Route::model('member', ...)`,
`Route::model('apiToken', Token::class)`).

`composer.json` scripts: `analyse`, `fix` (pint), `test`, `ptest` (parallel),
`test:coverage`, `generate-typescript` (`artisan model:typer > resources/js/types/models.ts`),
`ide-helper`, `refresh-schema-dump`.

### 3.8 Contributing rules (relevant if this goes upstream)

`CONTRIBUTING.md`: feature requests go in **Discussions**, bugs in Issues; **only work on approved
issues**; PRs from non-vouched authors are **auto-closed unless ≤50 changed lines** (test files and
lockfiles excluded from the count) — vouched list is `.github/VOUCHED.td`, and you get vouched by
opening a discussion, agreeing an approach, and a maintainer commenting `vouch @handle`. A **CLA**
must be signed. Required before commit: `composer fix` + `composer analyse` (backend),
`npm run lint:fix` + `npm run format` (frontend). PRs need a summary, reasoning, `Closes #123`, and a
statement of what was tested and how.

There is **no `CLAUDE.md`, `.claude/`, `AGENTS.md`, or `.cursorrules`** in the repo, and `docs/`
contains only a banner image.

### 3.9 Google API facts (from Google's docs, August 2026)

- Events endpoint: `GET https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events`, with
  `calendarId = primary` for the user's main calendar. Useful params: `timeMin`/`timeMax` (RFC3339;
  `timeMin` bounds event *end* time, `timeMax` bounds event *start* time), `singleEvents=true`
  (expands recurring events into instances), `orderBy=startTime` (requires `singleEvents`),
  `maxResults` (default 250, max 2500), `pageToken`, `showDeleted`, `syncToken`, `eventTypes`.
- Event resource fields of interest: `id`, `summary` (the title), `start`/`end`, `status`,
  `transparency`, `eventType`, `attendees[].responseStatus`, `htmlLink`. **All-day events use
  `start.date` / `end.date` instead of `start.dateTime`** — that is how to detect them.
- Token refresh: `Socialite::driver('google')->refreshToken($refreshToken)` returns a
  `Laravel\Socialite\Two\Token` with `token`, `refreshToken`, `expiresIn`, `approvedScopes`. **Google
  does not reissue a refresh token on refresh** — keep the stored one. Getting a refresh token in the
  first place requires `access_type=offline`; `prompt=consent` makes it reliable (there are open
  Socialite issues about Google intermittently omitting it otherwise).
- Revocation: `POST https://oauth2.googleapis.com/revoke?token=<token>`.
- Socialite's Google driver defaults to scopes `openid profile email`, so a minimal request **must**
  use `setScopes()` (overwrite), not `scopes()` (merge).
- Socialite ships `Socialite::fake('google', $user)` plus `(new User)->map([...])->setToken(...)
  ->setRefreshToken(...)->setExpiresIn(...)->setApprovedScopes([...])` for tests.
- **`calendar.events.readonly` is a *sensitive* scope.** Verification (a review with a demo video) is
  required for published apps, with exemptions for development/testing/staging, personal use,
  internal use within a Google Workspace organization, and under 100 users.

---

## 4. UNVERIFIED items — check these before relying on them

1. **Socialite's `user()` with only `userinfo.email` granted.** Socialite's Google provider calls
   `https://www.googleapis.com/oauth2/v3/userinfo`. Google's docs indicate that endpoint returns
   `sub` and `email` for tokens carrying `userinfo.email`, but this was not tested. If `getId()` or
   `getEmail()` comes back empty, add the `openid` scope — it does not widen data access, though it
   does add an "Associate you with your personal info on Google" line to the consent screen.
2. **Exact consent-screen wording** in the manual verification step below.
3. Everything in §3 was read from the repo at commit `de13c078` on `main`. Line numbers will drift as
   you edit; treat them as starting points, not fixed addresses.

---

## 5. Implementation plan (approved)

### 5.1 Dependency and config

- `composer require laravel/socialite`
- `config/services.php` — add alongside `gotenberg`:
  ```php
  'google' => [
      'client_id' => env('GOOGLE_CLIENT_ID'),
      'client_secret' => env('GOOGLE_CLIENT_SECRET'),
      'redirect' => '/integrations/google-calendar/callback',
  ],
  ```
  (Socialite resolves a relative `redirect` against `APP_URL`.)
- `.env.example` and `.env.ci` — add commented `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` under
  `# Services`.
- `app/Service/GoogleCalendar/GoogleCalendarConfig.php` with `isConfigured(): bool` = both
  credentials non-empty. Everything user-facing gates on this, so self-hosters without a Google
  project see nothing. (Respect phpstan's `noEnvCallsOutsideOfConfig` — read via `config()`.)
- `app/Http/Middleware/HandleInertiaRequests.php` — share `'google_calendar_enabled' => $isConfigured`
  beside the existing `has_*_extension` flags.

### 5.2 Migration, model, factory

`database/migrations/2026_08_06_000001_create_google_calendar_connections_table.php`, modelled on
`2024_08_01_104840_create_reports_table.php`:

| column | notes |
|---|---|
| `id` | uuid, primary |
| `user_id` | uuid, **unique** (one connection per user), FK → `users`, `cascadeOnUpdate` + `restrictOnDelete` |
| `google_user_id` | string — the `sub`; detects "you reconnected a different account" |
| `email` | string nullable |
| `access_token` | text |
| `refresh_token` | text nullable (Google omits it on re-consent) |
| `expires_at` | timestamp nullable |
| `scopes` | jsonb |
| `requires_reauthentication` | boolean, default false — set when Google rejects the refresh token |
| `timestamps` | |

`app/Models/GoogleCalendarConnection.php` — `App\Models\Concerns\HasUuids`, `HasFactory`,
`belongsTo(User::class)`. **Deliberately not `CustomAuditable`** — audit rows would copy the tokens.
Casts: `access_token`/`refresh_token` ⇒ `'encrypted'`, `expires_at` ⇒ `'datetime'`, `scopes` ⇒
`'array'`, `requires_reauthentication` ⇒ `'bool'`. Needs a complete `@property` docblock for
phpstan's `checkModelProperties`. No `enforceMorphMap` entry needed (not in any morph relation).

Also:
- `app/Models/User.php` — add `googleCalendarConnection(): HasOne`.
- `app/Service/DeletionService.php::deleteUser()` — delete the connection beside
  `$user->accessTokens()->delete();` (~line 171). Without this, `restrictOnDelete` blocks user
  deletion.
- `database/factories/GoogleCalendarConnectionFactory.php` — `definition()` plus `forUser()`,
  `expired()`, `requiresReauthentication()` states.

### 5.3 Service layer

`app/Service/GoogleCalendar/`:

- **`GoogleCalendarEventDto`** — `id`, `title`, `start` (`CarbonImmutable`), `end`, `isAllDay`,
  `htmlLink`. Mirror `app/Service/IpLookup/IpLookupResponseDto.php`'s constructor-assignment style.
- **`GoogleCalendarService`**
  - `eventsForRange(GoogleCalendarConnection $c, CarbonInterface $start, CarbonInterface $end): array<GoogleCalendarEventDto>`
    → `GET .../calendar/v3/calendars/primary/events` with `timeMin`, `timeMax`, `singleEvents=true`,
    `orderBy=startTime`, `maxResults=250`, following `nextPageToken`. Skip
    `status === 'cancelled'`. All-day → `start.date` present, no `start.dateTime`.
  - `ensureFreshAccessToken(GoogleCalendarConnection $c): string` — refresh when `expires_at` is
    within ~60s via `Socialite::driver('google')->refreshToken($c->refresh_token)`; persist the new
    access token and expiry; **keep the existing refresh token**. On `invalid_grant`, set
    `requires_reauthentication = true` and throw.
  - `revoke(GoogleCalendarConnection $c): void` — best-effort
    `POST https://oauth2.googleapis.com/revoke?token=…`; failures logged, not thrown.
  - HTTP style per `app/Service/ApiService.php`: base URL as a class const, `Http::asJson()` with
    explicit `timeout`/`connectTimeout`, status checked manually.
- **`app/Exceptions/Api/`** — `GoogleCalendarNotConnectedApiException`,
  `GoogleCalendarReauthenticationRequiredApiException`, `GoogleCalendarRequestFailedApiException`,
  each with a `KEY` const, plus messages in `lang/en/exceptions.php` under `'api'`.

### 5.4 Routes and controllers

**Web** — `routes/web.php`, inside the existing `['auth:web','auth.session','verified']` group (the
session guard is required for the OAuth `state` round-trip). New
`app/Http/Controllers/Web/GoogleCalendarConnectionController.php`; both actions `abort(404)` unless
configured (register the routes unconditionally so Ziggy and tests always resolve the names):

```php
Route::get('/integrations/google-calendar/connect',  [..., 'connect'])->name('integrations.google-calendar.connect');
Route::get('/integrations/google-calendar/callback', [..., 'callback'])->name('integrations.google-calendar.callback');
```

- `connect()` — `Socialite::driver('google')->setScopes([...])
  ->with(['access_type' => 'offline', 'prompt' => 'consent'])->redirect()`.
- `callback()` — handle `?error=access_denied` by redirecting to `profile.show` with a
  `bannerStyle=danger` flash. Otherwise `updateOrCreate` on `user_id`, clear
  `requires_reauthentication`, flash success.

**API** — `routes/api.php`, inside `['auth:api','verified']`, mirroring the `users.time-entries.`
group. New `app/Http/Controllers/Api/V1/GoogleCalendarController.php`. User-scoped, so **no
`PermissionStore` entries and no organization binding** — exactly like `ApiTokenController`:

```php
Route::name('users.google-calendar.')->group(static function (): void {
    Route::get('/users/me/google-calendar',        [GoogleCalendarController::class, 'show'])->name('show');
    Route::delete('/users/me/google-calendar',     [GoogleCalendarController::class, 'destroy'])->name('destroy');
    Route::get('/users/me/google-calendar/events', [GoogleCalendarController::class, 'events'])->name('events');
});
```

- `show()` → `GoogleCalendarConnectionResource` in `app/Http/Resources/V1/GoogleCalendar/`, extending
  `BaseResource`, per-field `@var` docblocks: `is_connected`, `email`, `requires_reauthentication`,
  `connected_at`. Return `is_connected: false` rather than 404, so the settings card has one shape.
- `destroy()` → revoke at Google, delete the row, `204`.
- `events()` → `GoogleCalendarEventIndexRequest` with `start`/`end`
  `required|date_format:Y-m-d\TH:i:s\Z` (the repo's strict UTC format — Google returns offsets, so
  convert), plus a max-range check (62 days) to bound upstream calls. Wrap in
  `Cache::remember("google-calendar:{$c->id}:{$start}:{$end}", 60, …)`.
- Scramble docblocks: `@operationId getGoogleCalendarConnection` /
  `deleteGoogleCalendarConnection` / `getGoogleCalendarEvents` — these become the TS client method
  names.

### 5.5 Backend tests

- `tests/Unit/Service/GoogleCalendar/GoogleCalendarServiceTest.php` (`#[CoversClass]`, `Http::fake()`)
  — maps timed events; flags all-day (`start.date`); skips `cancelled`; follows `nextPageToken`;
  refreshes an expired access token and persists it; keeps the old refresh token when Google omits
  one; sets `requires_reauthentication` on `invalid_grant`; surfaces non-200 as
  `GoogleCalendarRequestFailedApiException`; handles `ConnectionException`.
- `tests/Unit/Endpoint/Api/V1/GoogleCalendarEndpointTest.php` (`#[UsesClass]`, `Passport::actingAs`)
  — unauthenticated 401; `show` with and without a connection; `destroy` revokes + deletes and cannot
  touch another user's connection; `events` returns the mapped payload, 400 when not connected,
  validation errors for bad/oversized ranges.
- `tests/Unit/Endpoint/Web/GoogleCalendarConnectionEndpointTest.php` (`#[CoversClass]`,
  `$this->actingAs`, `Socialite::fake('google', …)`) — connect route redirects; callback stores the
  connection with tokens **not** readable as plaintext in the DB; callback replaces an existing
  connection and clears `requires_reauthentication`; `access_denied` redirects with an error flash;
  both routes require auth; both 404 when unconfigured.
- `tests/Unit/Service/DeletionServiceTest.php` — add: deleting a user removes the connection.

### 5.6 Calendar grid

Keep `packages/ui` provider-agnostic — it must not know the word "Google". Call the concept
**external calendar events** so a future Outlook integration drops in.

- **`packages/ui/src/FullCalendar/externalCalendarTypes.ts`** —
  `ExternalCalendarEvent { id, title, start, end, isAllDay }` and
  `ExternalEventBox { dateStr, top, height, left, width, event }`.
- **Refactor first (reuse, don't duplicate).** `useCalendarEvents.ts` holds the day-clipping and
  overlap-column algorithm as module-private functions — `clipEventToDay`, `assignColumns`,
  `groupOverlappingEvents`, `groupsToDayEvents` (lines 22-167). Extract them into
  `packages/ui/src/FullCalendar/eventLayout.ts`, generic over `{ dayStart: Dayjs; dayEnd: Dayjs }`,
  and import them back into `useCalendarEvents.ts`. Overlapping Google events then stack side-by-side
  inside their lane for free.
- **`useExternalEventBoxes.ts`** — same signature shape as `useActivityBoxes.ts`
  (`{ externalEvents, viewDays, calendarSettings, minutesToPixels }`), returning
  `externalEventBoxesForDay(dateStr)` and `dayHasExternalEvents(dateStr)`. Drops all-day events (they
  have no grid position).
- **`CalendarDayColumn.vue`** — new props `externalEventBoxes`, `hasExternalEvents`. The lane renders
  like the activity boxes but **anchored to the right edge** (`right: 0`, width ~45%), with time
  entries inset from the right when the day has any external events. Each box carries a
  hover-revealed copy button (`DocumentDuplicateIcon`, `aria-label="Copy as time entry"`) emitting
  `external-event-copy`, plus `data-external-event-id` so the context menu can find it.

  ```
  ┌──────────── Wed ────────────┐
  │▏│ TimeEntry      │ ▓GCal▓   │   ▏ = activity gutter (left, existing)
  │▏│                │ ▓event▓  │   ▓ = Google events lane (right, new)
  │▏│ TimeEntry      │          │
  └─────────────────────────────┘
  ```

  **Simplify while here:** the column hard-codes two left-inset classes
  (`.fc-events-inset { left: 8px }` / `.fc-events-inset-expanded { left: 204px }`, lines 412-418) for
  the one existing gutter. A right-hand lane would turn that into a 2×2 class matrix. Replace both
  with a single computed inset applied as an inline style — `left` from the activity gutter, `right`
  from the external lane — so the two lanes compose instead of multiplying.
- **`TimeEntryCalendar.vue`** — new props `externalCalendarEvents?: ExternalCalendarEvent[]` and
  `copyExternalEvent?: (event) => Promise<void>`; wire `useExternalEventBoxes` beside the existing
  `useActivityBoxes` call (line 187) and pass the new props into `CalendarDayColumn` (line 634).
- **`useContextMenu.ts`** — extend `handleCalendarContextMenu` to recognise
  `[data-external-event-id]`, add a `contextMenuExternalEvent` ref, and drive two new
  `ContextMenuItem`s in `TimeEntryCalendar.vue`: "Copy as time entry" and "Copy and edit…" (the
  latter via the existing `onCreateEvent(start, end)` path that opens `TimeEntryCreateModal`,
  extended to accept a prefilled description).

### 5.7 Query layer, settings card, page wiring

`resources/js/utils/useGoogleCalendarQuery.ts`, modelled on `useTimeEntriesCalendarQuery.ts`:

- `useGoogleCalendarConnectionQuery()` — key `['googleCalendar','connection']`.
- `useGoogleCalendarEventsQuery(start, end)` — reuse the exported `getExpandedCalendarDateRange()` so
  it prefetches prev/next period like time entries do; `enabled` on connected + configured;
  `placeholderData: (prev) => prev`; `staleTime: 60_000`.
- `useGoogleCalendarMutations()` — `disconnect`, via `handleApiRequestNotifications` +
  `queryClient.invalidateQueries`.

Add to `resources/js/packages/api/src/index.ts`:
`export type GoogleCalendarEvent = ZodiosResponseByAlias<SolidTimeApi, 'getGoogleCalendarEvents'>['data'][0];`
Add `/calendar` prefetching in `resources/js/utils/prefetch.ts:40`.

`resources/js/Pages/Profile/Partials/GoogleCalendarForm.vue`, added to `Profile/Show.vue` between
`TwoFactorAuthenticationForm` and `ApiTokensForm`, separated by `<SectionBorder />`, rendered only
when the shared `google_calendar_enabled` prop is true. Mirror `ApiTokensForm.vue`: `ActionSection` +
`SectionTitle` `#aside` `Badge` for status + `ConfirmationModal` for disconnect. Three states — not
connected / connected (shows the email) / reconnect required. **Connect must be a plain
`<a :href="route('integrations.google-calendar.connect')">`, not an Inertia link** — OAuth needs a
real top-level navigation. Add `resources/js/packages/ui/src/Icons/GoogleIcon.vue` (following
`BillableIcon.vue`), since neither icon library ships a Google glyph.

`resources/js/Pages/Calendar.vue` — call `useGoogleCalendarEventsQuery(calendarStart, calendarEnd)`
(the existing `@dates-change` handler at line 106 already maintains that range), map API events to
`ExternalCalendarEvent`, and pass a `copyExternalEvent` callback that calls the existing
`createTimeEntry` (which already injects `member_id`) with
`{ start, end, description: event.title, billable: false, type: 'work', project_id: null, task_id: null, tags: [] }`.

### 5.8 Frontend tests

- `packages/ui/src/FullCalendar/eventLayout.test.ts` — covers the extracted algorithm directly
  (currently only exercised indirectly).
- `packages/ui/src/FullCalendar/useExternalEventBoxes.test.ts` — clipping to day and to the visible
  hour range, all-day exclusion, multi-day spanning events, overlap column layout within the
  right-hand lane.
- `e2e/google-calendar.spec.ts` — stub the API with `page.route()` on
  `**/api/v1/users/me/google-calendar**` (cleaner than the `window.__TEST_SET_ACTIVITY_PERIODS__`
  hook, and it exercises the real query path). Assert: boxes render in the lane and sit to the
  **right** of the day's time entries (compare bounding boxes); time entries are inset from the right
  only on days that have external events; hovering reveals the copy button; clicking it POSTs to
  `/time-entries` with `description` equal to the event title and matching start/end, and the entry
  then appears as an `.fc-event`; right-click "Copy and edit…" opens the prefilled dialog; an all-day
  event is not drawn.
- `e2e/profile.spec.ts` — add: the Google Calendar card shows "Not connected" and the connect link
  points at the right route.

### 5.9 Regeneration and housekeeping

Order matters — the TS client is generated from the running app:

```bash
php artisan migrate
composer generate-typescript                     # resources/js/types/models.ts
php artisan scramble:export --path=openapi.json
npm run zod:generate                             # needs the app served at http://localhost:80
```

Also add a short note (README bullet or `docs/`) on creating the Google Cloud OAuth client, since
self-hosters need it: enable the Google Calendar API, create a **Web application** OAuth client, add
`https://<host>/integrations/google-calendar/callback` as an authorised redirect URI.

---

## 6. Verification

```bash
composer fix && composer analyse           # pint, then phpstan level 7
composer test                              # or: composer ptest
npm run lint:fix && npm run format && npm run type-check
npm run test:unit
npm run test:e2e -- google-calendar
```

1. `composer test` — all new backend tests green, and `tests/Unit/Database/MigrationTest.php` still
   passes (proves `down()` works).
2. `composer analyse` at level 7 with `checkModelProperties` — the new model's `@property` block must
   be complete.
3. **Real end-to-end, manually:** create a Google Cloud OAuth client, set `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`, visit `/user/profile`, connect. Confirm the consent screen lists only
   event-reading and the email address, and **no** write permission. Then open `/calendar` on a week
   with real meetings and confirm they appear in the right-hand lane and that one click produces a
   time entry titled with the event.
4. **Token refresh** — set `expires_at` in the past directly in the DB, reload `/calendar`, confirm
   events still load and `access_token` changed. This is the part most likely to break in production
   and the manual pass does not otherwise exercise it.
5. **Disconnect** — disconnect, then check <https://myaccount.google.com/permissions> shows the grant
   is gone (proves `revoke` fired), and that `/calendar` no longer shows the lane.

---

## 7. Caveats

- **Google verification.** `calendar.events.readonly` is a *sensitive* scope. Fine in testing mode,
  for internal-only use within a Google Workspace organization, or under 100 users; beyond that
  Google requires app verification. Self-hosters each create their own OAuth client, so this only
  bites a public multi-tenant deployment.
- **Upstream contribution.** See §3.8 — over 50 changed lines from a non-vouched author is
  auto-closed, and an approved discussion plus a signed CLA are prerequisites. If this is meant to
  land upstream rather than live on a fork, comment on discussion #358 with the approach and get
  vouched **before** writing code.
- **All-day events** are fetched and flagged but not drawn (no grid position). Rendering them in the
  day-header strip is a natural follow-up, deliberately out of scope.
- **Queue driver is `sync` by default** — avoid designing anything that assumes a running worker.

---

## 8. Starting state

- Branch: `main`, at commit `de13c078`, working tree clean apart from this file.
- No code has been written. No dependency has been added. `composer.json`/`package.json` are untouched.
- The plan also exists at `~/.claude/plans/this-is-the-solid-mutable-panda.md` on the planning
  machine; this document supersedes it (it includes the same plan plus the repo knowledge).
