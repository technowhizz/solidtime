<?php

declare(strict_types=1);

namespace App\Service\Jira;

use App\Enums\TimeEntryType;
use App\Models\TimeEntry;
use Carbon\CarbonImmutable;

class JiraWorklogGrouper
{
    /** Jira rejects a worklog shorter than this. */
    public const int MINIMUM_WORKLOG_SECONDS = 60;

    public function __construct(private readonly JiraIssueKeyParser $issueKeyParser) {}

    /**
     * Identifies a group without storing which entries formed it. Membership is recomputed from
     * the entries at sync time, so editing a description simply moves an entry into a different
     * group and the old one is reconciled away.
     */
    public static function groupHash(string $issueKey, string $workDate, ?string $comment): string
    {
        return hash('sha256', implode("\0", [$issueKey, $workDate, $comment ?? '']));
    }

    /**
     * Buckets time entries into the worklogs they should produce, and records why each of the
     * rest was left out.
     *
     * @param  iterable<int, TimeEntry>  $timeEntries
     * @param  string  $timezone  The user's timezone. An entry started at 23:30 belongs to that
     *                            local day, not to the following UTC one.
     * @param  list<string>  $allowedProjectKeys
     * @param  string|null  $syncFromDate  Local date (Y-m-d) before which work is treated as
     *                                     already logged in Jira, ex. imported history
     */
    public function group(iterable $timeEntries, string $timezone, array $allowedProjectKeys = [], ?string $syncFromDate = null): JiraWorklogGroupingResult
    {
        /** @var array<string, array{issueKey: string, workDate: string, comment: string|null, durationSeconds: int, startedAt: CarbonImmutable, timeEntryIds: list<string>}> $buckets */
        $buckets = [];
        /** @var array<string, JiraSkipReason> $skipped */
        $skipped = [];

        foreach ($timeEntries as $timeEntry) {
            if ($timeEntry->type === TimeEntryType::Break) {
                $skipped[$timeEntry->getKey()] = JiraSkipReason::Break;

                continue;
            }

            if ($timeEntry->end === null) {
                $skipped[$timeEntry->getKey()] = JiraSkipReason::StillRunning;

                continue;
            }

            $startedAt = CarbonImmutable::instance($timeEntry->start)->setTimezone($timezone);
            $workDate = $startedAt->format('Y-m-d');

            // Checked before the issue key, so imported history without keys does not light up
            // with red dots for work nobody intends to sync
            if ($syncFromDate !== null && $workDate < $syncFromDate) {
                $skipped[$timeEntry->getKey()] = JiraSkipReason::BeforeCutoff;

                continue;
            }

            $reference = $this->issueKeyParser->parse($timeEntry->description, $allowedProjectKeys);
            if ($reference === null) {
                $skipped[$timeEntry->getKey()] = JiraSkipReason::NoIssueKey;

                continue;
            }

            $hash = self::groupHash($reference->issueKey, $workDate, $reference->comment);
            $durationSeconds = (int) $timeEntry->start->diffInSeconds($timeEntry->end, true);

            if (! isset($buckets[$hash])) {
                $buckets[$hash] = [
                    'issueKey' => $reference->issueKey,
                    'workDate' => $workDate,
                    'comment' => $reference->comment,
                    'durationSeconds' => 0,
                    'startedAt' => $startedAt,
                    'timeEntryIds' => [],
                ];
            }

            $buckets[$hash]['durationSeconds'] += $durationSeconds;
            $buckets[$hash]['timeEntryIds'][] = $timeEntry->getKey();
            // The group is logged against the moment the work first started that day
            if ($startedAt->isBefore($buckets[$hash]['startedAt'])) {
                $buckets[$hash]['startedAt'] = $startedAt;
            }
        }

        $groups = [];
        foreach ($buckets as $hash => $bucket) {
            // Checked on the total rather than per entry: three twenty second entries are a
            // perfectly valid minute of work
            if ($bucket['durationSeconds'] < self::MINIMUM_WORKLOG_SECONDS) {
                foreach ($bucket['timeEntryIds'] as $timeEntryId) {
                    $skipped[$timeEntryId] = JiraSkipReason::TooShort;
                }

                continue;
            }

            $groups[] = new JiraWorklogGroupDto(
                issueKey: $bucket['issueKey'],
                workDate: $bucket['workDate'],
                comment: $bucket['comment'],
                groupHash: $hash,
                durationSeconds: $bucket['durationSeconds'],
                startedAt: $bucket['startedAt'],
                timeEntryIds: $bucket['timeEntryIds'],
            );
        }

        // Stable, readable order for the preview: by day, then by issue
        usort($groups, static fn (JiraWorklogGroupDto $a, JiraWorklogGroupDto $b): int => [$a->workDate, $a->issueKey, $a->comment ?? ''] <=> [$b->workDate, $b->issueKey, $b->comment ?? '']);

        return new JiraWorklogGroupingResult($groups, $skipped);
    }
}
