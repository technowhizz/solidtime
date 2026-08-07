<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\GoogleCalendarConnection;
use App\Models\User;
use App\Service\GoogleCalendar\GoogleCalendarConfig;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<GoogleCalendarConnection>
 */
class GoogleCalendarConnectionFactory extends Factory
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
            'google_user_id' => (string) $this->faker->numerify('######################'),
            'email' => $this->faker->safeEmail(),
            'access_token' => 'access-token-'.$this->faker->uuid(),
            'refresh_token' => 'refresh-token-'.$this->faker->uuid(),
            'expires_at' => Carbon::now()->addHour(),
            'scopes' => GoogleCalendarConfig::SCOPES,
            'requires_reauthentication' => false,
        ];
    }

    public function forUser(User $user): self
    {
        return $this->state(fn (array $attributes): array => [
            'user_id' => $user->getKey(),
        ]);
    }

    public function expired(): self
    {
        return $this->state(fn (array $attributes): array => [
            'expires_at' => Carbon::now()->subHour(),
        ]);
    }

    public function withoutRefreshToken(): self
    {
        return $this->state(fn (array $attributes): array => [
            'refresh_token' => null,
        ]);
    }

    public function requiresReauthentication(): self
    {
        return $this->state(fn (array $attributes): array => [
            'requires_reauthentication' => true,
        ]);
    }
}
