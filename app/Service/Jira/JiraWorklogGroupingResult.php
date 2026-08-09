<?php

declare(strict_types=1);

namespace App\Service\Jira;

class JiraWorklogGroupingResult
{
    /**
     * @param  list<JiraWorklogGroupDto>  $groups
     * @param  array<string, JiraSkipReason>  $skipped  Keyed by time entry id
     */
    public function __construct(
        public readonly array $groups,
        public readonly array $skipped,
    ) {}
}
