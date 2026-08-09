<?php

declare(strict_types=1);

namespace App\Service\Jira;

use Carbon\CarbonImmutable;

/**
 * One Jira worklog's worth of solidtime time entries: everything on the same issue, with the
 * same comment, on the same local day.
 */
class JiraWorklogGroupDto
{
    /**
     * @param  string  $workDate  Local date (Y-m-d) in the user's timezone
     * @param  CarbonImmutable  $startedAt  Earliest start in the group, in the user's timezone
     * @param  list<string>  $timeEntryIds  Which entries formed this group, for the per entry indicators
     */
    public function __construct(
        public readonly string $issueKey,
        public readonly string $workDate,
        public readonly ?string $comment,
        public readonly string $groupHash,
        public readonly int $durationSeconds,
        public readonly CarbonImmutable $startedAt,
        public readonly array $timeEntryIds,
    ) {}
}
