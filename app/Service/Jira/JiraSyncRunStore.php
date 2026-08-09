<?php

declare(strict_types=1);

namespace App\Service\Jira;

use App\Models\User;
use Illuminate\Support\Facades\Cache;

/**
 * Progress of a queued sync, so the dialog can follow along.
 *
 * Kept in the cache rather than a table because a run is only interesting while someone is
 * watching it - what actually happened is recorded in jira_worklogs either way.
 */
class JiraSyncRunStore
{
    /** Long enough to survive a slow Jira and someone wandering off mid-sync. */
    private const int TTL_SECONDS = 3600;

    /**
     * Namespaced by user, so a guessed run id cannot read someone else's results.
     */
    private function key(User $user, string $runId): string
    {
        return 'jira-sync-run:'.$user->getKey().':'.$runId;
    }

    public function queued(User $user, string $runId, string $startDate, string $endDate, int $total): void
    {
        $this->put($user, $runId, [
            'id' => $runId,
            'status' => 'queued',
            'start' => $startDate,
            'end' => $endDate,
            'total' => $total,
            'done' => 0,
            'results' => [],
            'error' => null,
        ]);
    }

    public function running(User $user, string $runId): void
    {
        $this->merge($user, $runId, ['status' => 'running']);
    }

    /**
     * @param  array<string, mixed>  $result
     */
    public function progressed(User $user, string $runId, int $done, int $total, array $result): void
    {
        $state = $this->get($user, $runId) ?? [];
        /** @var list<array<string, mixed>> $results */
        $results = is_array($state['results'] ?? null) ? $state['results'] : [];
        $results[] = $result;

        $this->merge($user, $runId, [
            'status' => 'running',
            'done' => $done,
            'total' => $total,
            'results' => $results,
        ]);
    }

    public function completed(User $user, string $runId): void
    {
        $this->merge($user, $runId, ['status' => 'completed']);
    }

    public function failed(User $user, string $runId, string $error): void
    {
        $this->merge($user, $runId, ['status' => 'failed', 'error' => $error]);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function get(User $user, string $runId): ?array
    {
        $state = Cache::get($this->key($user, $runId));

        return is_array($state) ? $state : null;
    }

    /**
     * @param  array<string, mixed>  $state
     */
    private function put(User $user, string $runId, array $state): void
    {
        Cache::put($this->key($user, $runId), $state, self::TTL_SECONDS);
    }

    /**
     * @param  array<string, mixed>  $changes
     */
    private function merge(User $user, string $runId, array $changes): void
    {
        $state = $this->get($user, $runId);
        if ($state === null) {
            return;
        }

        $this->put($user, $runId, array_merge($state, $changes));
    }
}
