<?php

declare(strict_types=1);

namespace Tests\Unit\Service\Jira;

use App\Enums\TimeEntryType;
use App\Exceptions\Api\JiraAuthenticationFailedApiException;
use App\Models\JiraConnection;
use App\Models\JiraWorklog;
use App\Models\Member;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Service\Jira\JiraSyncAction;
use App\Service\Jira\JiraSyncPlanDto;
use App\Service\Jira\JiraSyncService;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\CoversClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(JiraSyncService::class)]
class JiraSyncServiceTest extends TestCaseWithDatabase
{
    private const string SITE_URL = 'https://acme.atlassian.net';

    private const string WORKLOG_URL = 'https://acme.atlassian.net/rest/api/3/issue/*';

    private User $user;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create(['timezone' => 'UTC']);
        $this->organization = Organization::factory()->withOwner($this->user)->create([
            'jira_site_url' => self::SITE_URL,
        ]);
        Member::factory()->forUser($this->user)->forOrganization($this->organization)->create();
        JiraConnection::factory()->forUser($this->user)->forOrganization($this->organization)->create();
    }

    private function service(): JiraSyncService
    {
        return app(JiraSyncService::class);
    }

    private function timeEntry(string $description, string $start, ?string $end, TimeEntryType $type = TimeEntryType::Work): TimeEntry
    {
        return TimeEntry::factory()
            ->forUser($this->user)
            ->forOrganization($this->organization)
            ->create([
                'description' => $description,
                'start' => $start,
                'end' => $end,
                'type' => $type,
            ]);
    }

    private function plan(): JiraSyncPlanDto
    {
        return $this->service()->plan($this->user, $this->organization, '2026-08-05', '2026-08-05');
    }

    public function test_plan_creates_a_worklog_for_a_group_that_has_never_been_synced(): void
    {
        // Arrange
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');

        // Act
        $plan = $this->plan();

        // Assert
        $this->assertCount(1, $plan->items);
        $this->assertSame(JiraSyncAction::Create, $plan->items[0]->action);
        $this->assertSame('PROJ-1', $plan->items[0]->issueKey);
        $this->assertSame(3600, $plan->items[0]->durationSeconds);
    }

    public function test_plan_leaves_an_unchanged_group_alone(): void
    {
        // Arrange
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->syncAndFake('10001');

        // Act
        $plan = $this->plan();

        // Assert
        $this->assertSame(JiraSyncAction::Unchanged, $plan->items[0]->action);
        $this->assertSame([], $plan->actionableItems());
    }

    public function test_plan_updates_a_group_that_gained_an_entry_after_it_was_synced(): void
    {
        // Arrange
        // This is the original script's bug: it keyed off individual entry ids, so any entry
        // already in the mapping file marked the whole group done and the extra hour was
        // silently dropped.
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->syncAndFake('10001');
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T14:00:00', '2026-08-05T15:00:00');

        // Act
        $plan = $this->plan();

        // Assert
        $this->assertCount(1, $plan->items);
        $this->assertSame(JiraSyncAction::Update, $plan->items[0]->action);
        $this->assertSame(3600, $plan->items[0]->previousDurationSeconds);
        $this->assertSame(7200, $plan->items[0]->durationSeconds);
    }

    public function test_plan_updates_a_group_whose_entry_was_shortened(): void
    {
        // Arrange
        $timeEntry = $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->syncAndFake('10001');
        $timeEntry->end = $timeEntry->end?->subMinutes(30);
        $timeEntry->save();

        // Act
        $plan = $this->plan();

        // Assert
        $this->assertSame(JiraSyncAction::Update, $plan->items[0]->action);
        $this->assertSame(1800, $plan->items[0]->durationSeconds);
    }

    public function test_plan_deletes_a_worklog_whose_entries_are_gone(): void
    {
        // Arrange
        $timeEntry = $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->syncAndFake('10001');
        $timeEntry->delete();

        // Act
        $plan = $this->plan();

        // Assert
        $this->assertCount(1, $plan->items);
        $this->assertSame(JiraSyncAction::Delete, $plan->items[0]->action);
        $this->assertSame('10001', $plan->items[0]->jiraWorklogId);
    }

    public function test_plan_moves_time_when_the_description_changes(): void
    {
        // Arrange
        $timeEntry = $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->syncAndFake('10001');
        $timeEntry->description = 'PROJ-2 fix login';
        $timeEntry->save();

        // Act
        $plan = $this->plan();
        $actions = array_map(static fn ($item): string => $item->action->value.':'.$item->issueKey, $plan->items);

        // Assert
        sort($actions);
        $this->assertSame(['create:PROJ-2', 'delete:PROJ-1'], $actions);
    }

    public function test_plan_reports_why_each_entry_was_skipped(): void
    {
        // Arrange
        $this->timeEntry('team standup', '2026-08-05T09:00:00', '2026-08-05T09:15:00');
        $this->timeEntry('PROJ-1 lunch', '2026-08-05T12:00:00', '2026-08-05T13:00:00', TimeEntryType::Break);
        $this->timeEntry('PROJ-1 still going', '2026-08-05T15:00:00', null);

        // Act
        $plan = $this->plan();
        $reasons = array_map(static fn ($entry): string => $entry->reason->value, $plan->skipped);

        // Assert
        sort($reasons);
        $this->assertSame(['break', 'no_issue_key', 'still_running'], $reasons);
    }

    public function test_execute_creates_a_worklog_and_records_it(): void
    {
        // Arrange
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        Http::fake([self::WORKLOG_URL => Http::response(['id' => '10001'], 201)]);

        // Act
        $results = $this->service()->execute($this->user, $this->organization, $this->plan());

        // Assert
        $this->assertSame('done', $results[0]['status']);
        $this->assertDatabaseHas('jira_worklogs', [
            'issue_key' => 'PROJ-1',
            'jira_worklog_id' => '10001',
            'duration_seconds' => 3600,
        ]);
        Http::assertSent(function (Request $request): bool {
            return $request->method() === 'POST'
                && $request->data()['timeSpentSeconds'] === 3600
                // Sent as rich text, which REST v3 requires
                && $request->data()['comment']['content'][0]['content'][0]['text'] === 'fix login';
        });
    }

    public function test_execute_sends_the_start_with_a_real_timezone_offset(): void
    {
        // Arrange
        // The original script stripped the Z off a UTC timestamp and re-stamped it +0000, so a
        // local time was sent as if it were UTC and the work landed at the wrong hour.
        $this->user->timezone = 'Europe/London';
        $this->user->save();
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        Http::fake([self::WORKLOG_URL => Http::response(['id' => '10001'], 201)]);

        // Act
        $this->service()->execute($this->user, $this->organization, $this->plan());

        // Assert
        Http::assertSent(function (Request $request): bool {
            // 09:00 UTC in August is 10:00 British Summer Time
            return $request->data()['started'] === '2026-08-05T10:00:00.000+0100';
        });
    }

    public function test_execute_updates_the_existing_worklog_rather_than_creating_a_second(): void
    {
        // Arrange
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->syncAndFake('10001');
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T14:00:00', '2026-08-05T15:00:00');
        Http::fake([self::WORKLOG_URL => Http::response([], 200)]);

        // Act
        $this->service()->execute($this->user, $this->organization, $this->plan());

        // Assert
        Http::assertSent(function (Request $request): bool {
            return $request->method() === 'PUT'
                && str_ends_with((string) parse_url($request->url(), PHP_URL_PATH), '/worklog/10001')
                && $request->data()['timeSpentSeconds'] === 7200;
        });
        $this->assertSame(1, JiraWorklog::query()->count());
        $this->assertSame(7200, JiraWorklog::query()->firstOrFail()->duration_seconds);
    }

    public function test_execute_deletes_the_worklog_and_forgets_it(): void
    {
        // Arrange
        $timeEntry = $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->syncAndFake('10001');
        $timeEntry->delete();
        Http::fake([self::WORKLOG_URL => Http::response([], 204)]);

        // Act
        $this->service()->execute($this->user, $this->organization, $this->plan());

        // Assert
        Http::assertSent(static fn (Request $request): bool => $request->method() === 'DELETE');
        $this->assertSame(0, JiraWorklog::query()->count());
    }

    public function test_execute_keeps_going_when_one_item_fails(): void
    {
        // Arrange
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->timeEntry('NOPE-9 typo in the key', '2026-08-05T11:00:00', '2026-08-05T12:00:00');
        Http::fake([
            'https://acme.atlassian.net/rest/api/3/issue/NOPE-9/worklog*' => Http::response([
                'errorMessages' => ['Issue does not exist or you do not have permission to see it.'],
            ], 404),
            self::WORKLOG_URL => Http::response(['id' => '10001'], 201),
        ]);

        // Act
        $results = $this->service()->execute($this->user, $this->organization, $this->plan());
        $statuses = array_column($results, 'status', 'issue_key');

        // Assert
        $this->assertSame('done', $statuses['PROJ-1']);
        $this->assertSame('failed', $statuses['NOPE-9']);
        // The good one still landed, and the failure explains itself
        $this->assertSame(1, JiraWorklog::query()->count());
        $errors = array_column($results, 'error', 'issue_key');
        $this->assertStringContainsString('Issue does not exist', (string) $errors['NOPE-9']);
    }

    public function test_execute_flags_the_connection_when_jira_rejects_the_credentials(): void
    {
        // Arrange
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        Http::fake([self::WORKLOG_URL => Http::response([], 401)]);

        // Act
        try {
            $this->service()->execute($this->user, $this->organization, $this->plan());
            $this->fail('Expected the sync to stop when the credentials are rejected');
        } catch (JiraAuthenticationFailedApiException) {
            // Expected
        }

        // Assert
        $this->assertTrue(JiraConnection::query()->firstOrFail()->requires_reauthentication);
    }

    public function test_status_for_reports_the_state_of_each_entry(): void
    {
        // Arrange
        $synced = $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->syncAndFake('10001');
        $pending = $this->timeEntry('PROJ-2 write tests', '2026-08-05T11:00:00', '2026-08-05T12:00:00');
        $missing = $this->timeEntry('team standup', '2026-08-05T13:00:00', '2026-08-05T13:15:00');
        $break = $this->timeEntry('lunch', '2026-08-05T12:00:00', '2026-08-05T12:30:00', TimeEntryType::Break);

        // Act
        $statuses = $this->service()->statusFor($this->user, $this->organization, '2026-08-05', '2026-08-05');

        // Assert
        $this->assertSame('synced', $statuses[$synced->getKey()]['state']);
        $this->assertSame('PROJ-1', $statuses[$synced->getKey()]['issue_key']);
        $this->assertSame('pending', $statuses[$pending->getKey()]['state']);
        // Only a work entry without a key raises the red dot
        $this->assertSame('no_reference', $statuses[$missing->getKey()]['state']);
        $this->assertSame('ignored', $statuses[$break->getKey()]['state']);
    }

    public function test_status_for_marks_a_changed_group_as_outdated(): void
    {
        // Arrange
        $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->syncAndFake('10001');
        $added = $this->timeEntry('PROJ-1 fix login', '2026-08-05T14:00:00', '2026-08-05T15:00:00');

        // Act
        $statuses = $this->service()->statusFor($this->user, $this->organization, '2026-08-05', '2026-08-05');

        // Assert
        $this->assertSame('outdated', $statuses[$added->getKey()]['state']);
    }

    public function test_plan_ignores_another_users_time_entries(): void
    {
        // Arrange
        $other = User::factory()->create(['timezone' => 'UTC']);
        Member::factory()->forUser($other)->forOrganization($this->organization)->create();
        TimeEntry::factory()->forUser($other)->forOrganization($this->organization)->create([
            'description' => 'PROJ-9 not mine',
            'start' => '2026-08-05T09:00:00',
            'end' => '2026-08-05T10:00:00',
        ]);

        // Act
        $plan = $this->plan();

        // Assert
        $this->assertSame([], $plan->items);
    }

    public function test_plan_ignores_work_before_the_connections_cutoff(): void
    {
        // Arrange
        // What the cutoff is for: history imported from Clockify that the old script already
        // logged to Jira should not be logged a second time.
        JiraConnection::query()->firstOrFail()->update(['sync_from_date' => '2026-08-05']);
        $this->timeEntry('PROJ-1 imported work', '2026-08-04T09:00:00', '2026-08-04T10:00:00');

        // Act
        $plan = $this->service()->plan($this->user, $this->organization, '2026-08-04', '2026-08-05');

        // Assert
        $this->assertSame([], $plan->items);
        $this->assertSame(['before_cutoff'], array_map(static fn ($entry): string => $entry->reason->value, $plan->skipped));
    }

    public function test_plan_does_not_delete_worklogs_from_before_a_cutoff_set_later(): void
    {
        // Arrange
        // Someone syncs a day, then sets a cutoff after it. Those worklogs are real work that
        // reached Jira - moving the cutoff must not reconcile them away.
        $timeEntry = $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00', '2026-08-05T10:00:00');
        $this->syncAndFake('10001');
        JiraConnection::query()->firstOrFail()->update(['sync_from_date' => '2026-08-06']);
        $timeEntry->delete();

        // Act
        $plan = $this->service()->plan($this->user, $this->organization, '2026-08-05', '2026-08-06');

        // Assert
        $this->assertSame([], $plan->items);
        $this->assertSame(1, JiraWorklog::query()->count());
    }

    /**
     * Runs a sync with a faked Jira so later assertions start from an already-synced state.
     */
    private function syncAndFake(string $worklogId): void
    {
        Http::fake([self::WORKLOG_URL => Http::response(['id' => $worklogId], 201)]);
        $this->service()->execute($this->user, $this->organization, $this->plan());
        Http::clearResolvedInstances();
    }
}
