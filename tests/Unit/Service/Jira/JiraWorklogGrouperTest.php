<?php

declare(strict_types=1);

namespace Tests\Unit\Service\Jira;

use App\Enums\TimeEntryType;
use App\Models\TimeEntry;
use App\Service\Jira\JiraIssueKeyParser;
use App\Service\Jira\JiraSkipReason;
use App\Service\Jira\JiraWorklogGrouper;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\Attributes\CoversClass;
use Tests\TestCase;

#[CoversClass(JiraWorklogGrouper::class)]
class JiraWorklogGrouperTest extends TestCase
{
    private function grouper(): JiraWorklogGrouper
    {
        return new JiraWorklogGrouper(new JiraIssueKeyParser);
    }

    /**
     * Built by hand rather than through the factory: the grouper is pure, so it needs no
     * database.
     */
    private function timeEntry(string $description, string $start, ?string $end, TimeEntryType $type = TimeEntryType::Work): TimeEntry
    {
        $timeEntry = new TimeEntry;
        $timeEntry->id = 'entry-'.md5($description.$start);
        $timeEntry->description = $description;
        $timeEntry->start = Carbon::parse($start, 'UTC');
        $timeEntry->end = $end === null ? null : Carbon::parse($end, 'UTC');
        $timeEntry->type = $type;

        return $timeEntry;
    }

    public function test_group_sums_entries_that_share_an_issue_comment_and_day(): void
    {
        // Arrange
        $entries = [
            $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00Z', '2026-08-05T10:00:00Z'),
            $this->timeEntry('PROJ-1 fix login', '2026-08-05T14:00:00Z', '2026-08-05T14:30:00Z'),
        ];

        // Act
        $result = $this->grouper()->group($entries, 'UTC');

        // Assert
        $this->assertCount(1, $result->groups);
        $this->assertSame('PROJ-1', $result->groups[0]->issueKey);
        $this->assertSame('fix login', $result->groups[0]->comment);
        $this->assertSame(5400, $result->groups[0]->durationSeconds);
        $this->assertCount(2, $result->groups[0]->timeEntryIds);
    }

    public function test_group_starts_the_worklog_at_the_earliest_entry_of_the_day(): void
    {
        // Arrange
        $entries = [
            $this->timeEntry('PROJ-1 fix login', '2026-08-05T14:00:00Z', '2026-08-05T14:30:00Z'),
            $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00Z', '2026-08-05T10:00:00Z'),
        ];

        // Act
        $result = $this->grouper()->group($entries, 'UTC');

        // Assert
        $this->assertSame('2026-08-05T09:00:00+00:00', $result->groups[0]->startedAt->toIso8601String());
    }

    public function test_group_keeps_different_comments_on_the_same_issue_apart(): void
    {
        // Arrange
        $entries = [
            $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00Z', '2026-08-05T10:00:00Z'),
            $this->timeEntry('PROJ-1 write tests', '2026-08-05T11:00:00Z', '2026-08-05T12:00:00Z'),
        ];

        // Act
        $result = $this->grouper()->group($entries, 'UTC');

        // Assert
        $this->assertCount(2, $result->groups);
    }

    public function test_group_keeps_the_same_work_on_different_days_apart(): void
    {
        // Arrange
        $entries = [
            $this->timeEntry('PROJ-1 fix login', '2026-08-05T09:00:00Z', '2026-08-05T10:00:00Z'),
            $this->timeEntry('PROJ-1 fix login', '2026-08-06T09:00:00Z', '2026-08-06T10:00:00Z'),
        ];

        // Act
        $result = $this->grouper()->group($entries, 'UTC');

        // Assert
        $this->assertCount(2, $result->groups);
        $this->assertSame('2026-08-05', $result->groups[0]->workDate);
        $this->assertSame('2026-08-06', $result->groups[1]->workDate);
    }

    public function test_group_uses_the_users_local_day_not_the_utc_one(): void
    {
        // Arrange
        // 23:30 in Sydney on the 5th is 13:30 UTC on the same day, but 00:30 UTC on the 6th
        // when the offset runs the other way. The worklog belongs to the day the person worked.
        $entry = $this->timeEntry('PROJ-1 late night', '2026-08-05T22:30:00Z', '2026-08-05T23:30:00Z');

        // Act
        $utc = $this->grouper()->group([$entry], 'UTC');
        $sydney = $this->grouper()->group([$entry], 'Australia/Sydney');

        // Assert
        $this->assertSame('2026-08-05', $utc->groups[0]->workDate);
        $this->assertSame('2026-08-06', $sydney->groups[0]->workDate);
    }

    public function test_group_skips_breaks(): void
    {
        // Arrange
        $entry = $this->timeEntry('PROJ-1 lunch', '2026-08-05T12:00:00Z', '2026-08-05T13:00:00Z', TimeEntryType::Break);

        // Act
        $result = $this->grouper()->group([$entry], 'UTC');

        // Assert
        $this->assertSame([], $result->groups);
        $this->assertSame(JiraSkipReason::Break, $result->skipped[$entry->getKey()]);
    }

    public function test_group_skips_a_running_entry(): void
    {
        // Arrange
        $entry = $this->timeEntry('PROJ-1 still going', '2026-08-05T09:00:00Z', null);

        // Act
        $result = $this->grouper()->group([$entry], 'UTC');

        // Assert
        $this->assertSame([], $result->groups);
        $this->assertSame(JiraSkipReason::StillRunning, $result->skipped[$entry->getKey()]);
    }

    public function test_group_skips_an_entry_without_an_issue_key(): void
    {
        // Arrange
        $entry = $this->timeEntry('team standup', '2026-08-05T09:00:00Z', '2026-08-05T09:15:00Z');

        // Act
        $result = $this->grouper()->group([$entry], 'UTC');

        // Assert
        $this->assertSame([], $result->groups);
        $this->assertSame(JiraSkipReason::NoIssueKey, $result->skipped[$entry->getKey()]);
    }

    public function test_group_skips_a_group_that_totals_under_a_minute(): void
    {
        // Arrange
        // Jira rejects a worklog shorter than a minute outright
        $entry = $this->timeEntry('PROJ-1 quick look', '2026-08-05T09:00:00Z', '2026-08-05T09:00:30Z');

        // Act
        $result = $this->grouper()->group([$entry], 'UTC');

        // Assert
        $this->assertSame([], $result->groups);
        $this->assertSame(JiraSkipReason::TooShort, $result->skipped[$entry->getKey()]);
    }

    public function test_group_keeps_short_entries_that_add_up_to_a_minute(): void
    {
        // Arrange
        $entries = [
            $this->timeEntry('PROJ-1 quick look', '2026-08-05T09:00:00Z', '2026-08-05T09:00:30Z'),
            $this->timeEntry('PROJ-1 quick look', '2026-08-05T10:00:00Z', '2026-08-05T10:00:40Z'),
        ];

        // Act
        $result = $this->grouper()->group($entries, 'UTC');

        // Assert
        $this->assertCount(1, $result->groups);
        $this->assertSame(70, $result->groups[0]->durationSeconds);
        $this->assertSame([], $result->skipped);
    }

    public function test_group_restricts_detection_to_the_allowed_project_keys(): void
    {
        // Arrange
        $entry = $this->timeEntry('fixed UTF-8 handling', '2026-08-05T09:00:00Z', '2026-08-05T10:00:00Z');

        // Act
        $result = $this->grouper()->group([$entry], 'UTC', ['PROJ']);

        // Assert
        $this->assertSame([], $result->groups);
        $this->assertSame(JiraSkipReason::NoIssueKey, $result->skipped[$entry->getKey()]);
    }

    public function test_group_skips_work_before_the_cutoff_date(): void
    {
        // Arrange
        // The cutoff exists so history imported from another tracker, which the old process
        // already logged, is not sent to Jira a second time.
        $before = $this->timeEntry('PROJ-1 imported from clockify', '2026-08-04T09:00:00Z', '2026-08-04T10:00:00Z');
        $onCutoff = $this->timeEntry('PROJ-1 first day in solidtime', '2026-08-05T09:00:00Z', '2026-08-05T10:00:00Z');

        // Act
        $result = $this->grouper()->group([$before, $onCutoff], 'UTC', [], '2026-08-05');

        // Assert
        $this->assertCount(1, $result->groups);
        $this->assertSame(['2026-08-05'], array_column($result->groups, 'workDate'));
        $this->assertSame(JiraSkipReason::BeforeCutoff, $result->skipped[$before->getKey()]);
    }

    public function test_group_reports_the_cutoff_rather_than_a_missing_key(): void
    {
        // Arrange
        // Imported entries often have no issue key at all. Reporting those as "missing" would
        // cover months of history in red dots for work nobody intends to sync.
        $entry = $this->timeEntry('some old imported work', '2026-08-04T09:00:00Z', '2026-08-04T10:00:00Z');

        // Act
        $result = $this->grouper()->group([$entry], 'UTC', [], '2026-08-05');

        // Assert
        $this->assertSame(JiraSkipReason::BeforeCutoff, $result->skipped[$entry->getKey()]);
    }

    public function test_group_uses_the_local_day_when_applying_the_cutoff(): void
    {
        // Arrange
        // 22:30 UTC on the 4th is already the 5th in Sydney, so it is on the right side of a
        // cutoff of the 5th there but not in UTC.
        $entry = $this->timeEntry('PROJ-1 late night', '2026-08-04T22:30:00Z', '2026-08-04T23:30:00Z');

        // Act
        $utc = $this->grouper()->group([$entry], 'UTC', [], '2026-08-05');
        $sydney = $this->grouper()->group([$entry], 'Australia/Sydney', [], '2026-08-05');

        // Assert
        $this->assertSame([], $utc->groups);
        $this->assertCount(1, $sydney->groups);
    }

    public function test_group_hash_is_stable_and_distinguishes_each_part(): void
    {
        // Act & Assert
        $this->assertSame(
            JiraWorklogGrouper::groupHash('PROJ-1', '2026-08-05', 'fix login'),
            JiraWorklogGrouper::groupHash('PROJ-1', '2026-08-05', 'fix login'),
        );
        $this->assertNotSame(
            JiraWorklogGrouper::groupHash('PROJ-1', '2026-08-05', 'fix login'),
            JiraWorklogGrouper::groupHash('PROJ-2', '2026-08-05', 'fix login'),
        );
        $this->assertNotSame(
            JiraWorklogGrouper::groupHash('PROJ-1', '2026-08-05', 'fix login'),
            JiraWorklogGrouper::groupHash('PROJ-1', '2026-08-06', 'fix login'),
        );
        $this->assertNotSame(
            JiraWorklogGrouper::groupHash('PROJ-1', '2026-08-05', 'fix login'),
            JiraWorklogGrouper::groupHash('PROJ-1', '2026-08-05', null),
        );
    }
}
