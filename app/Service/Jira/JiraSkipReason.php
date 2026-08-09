<?php

declare(strict_types=1);

namespace App\Service\Jira;

enum JiraSkipReason: string
{
    /** A work entry whose description contains no issue key - what the red dot marks. */
    case NoIssueKey = 'no_issue_key';

    /** Still running, so its duration is not final yet. */
    case StillRunning = 'still_running';

    /** Breaks are not work and are never logged to Jira. */
    case Break = 'break';

    /** Jira rejects a worklog shorter than a minute. */
    case TooShort = 'too_short';

    /**
     * Older than the connection's cutoff date. Used when the time before it is already in
     * Jira - history imported from Toggl or Clockify that the old process already logged.
     */
    case BeforeCutoff = 'before_cutoff';
}
