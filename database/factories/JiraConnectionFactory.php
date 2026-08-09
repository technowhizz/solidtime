<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\JiraConnection;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<JiraConnection>
 */
class JiraConnectionFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'organization_id' => Organization::factory(),
            'email' => $this->faker->safeEmail(),
            'account_id' => (string) $this->faker->numerify('5b10a2844c20165700ede####'),
            'display_name' => $this->faker->name(),
            'api_token' => 'api-token-'.$this->faker->uuid(),
            'requires_reauthentication' => false,
            'sync_from_date' => null,
            'last_verified_at' => Carbon::now(),
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
     * Everything before this local date is treated as already logged in Jira.
     */
    public function syncFrom(string $date): self
    {
        return $this->state(fn (array $attributes): array => [
            'sync_from_date' => $date,
        ]);
    }

    public function requiresReauthentication(): self
    {
        return $this->state(fn (array $attributes): array => [
            'requires_reauthentication' => true,
        ]);
    }
}
