<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\JiraWorklog;
use App\Models\Organization;
use App\Models\User;
use App\Service\Jira\JiraWorklogGrouper;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<JiraWorklog>
 */
class JiraWorklogFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $issueKey = 'PROJ-'.$this->faker->numberBetween(1, 9999);
        $workDate = Carbon::now()->format('Y-m-d');
        $comment = $this->faker->sentence();

        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'issue_key' => $issueKey,
            'work_date' => $workDate,
            'comment' => $comment,
            'group_hash' => JiraWorklogGrouper::groupHash($issueKey, $workDate, $comment),
            'jira_worklog_id' => (string) $this->faker->numberBetween(10000, 99999),
            'duration_seconds' => $this->faker->numberBetween(1, 8) * 900,
            'started_at' => Carbon::now()->subHours(2),
            'synced_at' => Carbon::now(),
        ];
    }

    public function forUser(User $user): self
    {
        return $this->state(fn (array $attributes): array => [
            'user_id' => $user->getKey(),
        ]);
    }

    public function forOrganization(Organization $organization): self
    {
        return $this->state(fn (array $attributes): array => [
            'organization_id' => $organization->getKey(),
        ]);
    }

    /**
     * Matches the group a set of time entries would produce, so a test can set up a worklog
     * that reconciliation will recognise as already synced.
     */
    public function forGroup(string $issueKey, string $workDate, ?string $comment): self
    {
        return $this->state(fn (array $attributes): array => [
            'issue_key' => $issueKey,
            'work_date' => $workDate,
            'comment' => $comment,
            'group_hash' => JiraWorklogGrouper::groupHash($issueKey, $workDate, $comment),
        ]);
    }
}
