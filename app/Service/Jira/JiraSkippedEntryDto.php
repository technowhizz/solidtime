<?php

declare(strict_types=1);

namespace App\Service\Jira;

/**
 * A time entry the sync will not touch, and why. This is the visual replacement for the
 * script's "Invalid Entries" table.
 */
class JiraSkippedEntryDto
{
    public function __construct(
        public readonly string $timeEntryId,
        public readonly string $description,
        public readonly string $start,
        public readonly int $durationSeconds,
        public readonly JiraSkipReason $reason,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'time_entry_id' => $this->timeEntryId,
            'description' => $this->description,
            'start' => $this->start,
            'duration' => $this->durationSeconds,
            'reason' => $this->reason->value,
        ];
    }
}
