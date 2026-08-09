<?php

declare(strict_types=1);

namespace App\Service\Jira;

class JiraSyncPlanDto
{
    /**
     * @param  list<JiraSyncItemDto>  $items
     * @param  list<JiraSkippedEntryDto>  $skipped
     */
    public function __construct(
        public readonly string $startDate,
        public readonly string $endDate,
        public readonly array $items,
        public readonly array $skipped,
    ) {}

    /**
     * The items that will actually cause a Jira request.
     *
     * @return list<JiraSyncItemDto>
     */
    public function actionableItems(): array
    {
        return array_values(array_filter(
            $this->items,
            static fn (JiraSyncItemDto $item): bool => $item->action !== JiraSyncAction::Unchanged,
        ));
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'start' => $this->startDate,
            'end' => $this->endDate,
            'items' => array_map(static fn (JiraSyncItemDto $item): array => $item->toArray(), $this->items),
            'skipped' => array_map(static fn (JiraSkippedEntryDto $entry): array => $entry->toArray(), $this->skipped),
        ];
    }
}
