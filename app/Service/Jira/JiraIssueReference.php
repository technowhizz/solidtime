<?php

declare(strict_types=1);

namespace App\Service\Jira;

class JiraIssueReference
{
    public function __construct(
        public readonly string $issueKey,
        /**
         * The description with the issue key taken out, or null if nothing was left. Jira
         * rejects an empty comment, and the worklog is already attached to the issue, so
         * "PROJ-123" on its own is better sent with no comment at all.
         */
        public readonly ?string $comment,
    ) {}
}
