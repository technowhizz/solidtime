<?php

declare(strict_types=1);

namespace Tests\Unit\Endpoint\Web;

use App\Http\Controllers\Web\GoogleCalendarConnectionController;
use App\Models\GoogleCalendarConnection;
use App\Models\User;
use App\Service\GoogleCalendar\GoogleCalendarConfig;
use Illuminate\Support\Facades\DB;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;
use PHPUnit\Framework\Attributes\CoversClass;

#[CoversClass(GoogleCalendarConnectionController::class)]
class GoogleCalendarConnectionEndpointTest extends EndpointTestAbstract
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'session.driver' => 'array',
            'services.google.client_id' => 'test-client-id',
            'services.google.client_secret' => 'test-client-secret',
        ]);
    }

    private function fakeGoogleUser(
        string $token = 'the-access-token',
        ?string $refreshToken = 'the-refresh-token',
        string $email = 'calendar-owner@example.com',
    ): SocialiteUser {
        $socialiteUser = new SocialiteUser;
        $socialiteUser->map([
            'id' => '1234567890',
            'name' => 'Calendar Owner',
            'email' => $email,
        ]);
        $socialiteUser->setToken($token);
        $socialiteUser->setExpiresIn(3599);
        $socialiteUser->setApprovedScopes(GoogleCalendarConfig::SCOPES);
        $socialiteUser->refreshToken = $refreshToken;

        return $socialiteUser;
    }

    public function test_connect_endpoint_fails_if_user_is_not_authenticated(): void
    {
        // Act
        $response = $this->get(route('integrations.google-calendar.connect'));

        // Assert
        $response->assertRedirect(route('login'));
    }

    public function test_connect_endpoint_redirects_to_google_asking_only_for_the_minimal_scopes(): void
    {
        // Arrange
        $user = User::factory()->withPersonalOrganization()->create();
        $this->actingAs($user);

        // Act
        $response = $this->get(route('integrations.google-calendar.connect'));

        // Assert
        $response->assertRedirectContains('accounts.google.com');
        $targetUrl = $response->headers->get('Location') ?? '';
        parse_str((string) parse_url($targetUrl, PHP_URL_QUERY), $query);
        $this->assertSame(implode(' ', GoogleCalendarConfig::SCOPES), $query['scope'] ?? null);
        $this->assertStringNotContainsString('auth/calendar.events ', (string) ($query['scope'] ?? ''));
        $this->assertSame('offline', $query['access_type'] ?? null);
        $this->assertSame('consent', $query['prompt'] ?? null);
        $this->assertSame(route('integrations.google-calendar.callback'), $query['redirect_uri'] ?? null);
    }

    public function test_connect_endpoint_returns_not_found_if_google_is_not_configured(): void
    {
        // Arrange
        config(['services.google.client_id' => null, 'services.google.client_secret' => null]);
        $user = User::factory()->withPersonalOrganization()->create();
        $this->actingAs($user);

        // Act
        $response = $this->get(route('integrations.google-calendar.connect'));

        // Assert
        $response->assertNotFound();
    }

    public function test_callback_endpoint_fails_if_user_is_not_authenticated(): void
    {
        // Act
        $response = $this->get(route('integrations.google-calendar.callback'));

        // Assert
        $response->assertRedirect(route('login'));
    }

    public function test_callback_endpoint_returns_not_found_if_google_is_not_configured(): void
    {
        // Arrange
        config(['services.google.client_id' => null, 'services.google.client_secret' => null]);
        $user = User::factory()->withPersonalOrganization()->create();
        $this->actingAs($user);

        // Act
        $response = $this->get(route('integrations.google-calendar.callback'));

        // Assert
        $response->assertNotFound();
    }

    public function test_callback_endpoint_stores_the_connection(): void
    {
        // Arrange
        $user = User::factory()->withPersonalOrganization()->create();
        $this->actingAs($user);
        Socialite::fake('google', $this->fakeGoogleUser());

        // Act
        $response = $this->get(route('integrations.google-calendar.callback', ['code' => 'the-code']));

        // Assert
        $response->assertRedirect(route('profile.show'));
        $response->assertSessionHas('bannerStyle', 'success');
        $connection = GoogleCalendarConnection::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        $this->assertSame('1234567890', $connection->google_user_id);
        $this->assertSame('calendar-owner@example.com', $connection->email);
        $this->assertSame('the-access-token', $connection->access_token);
        $this->assertSame('the-refresh-token', $connection->refresh_token);
        $this->assertSame(GoogleCalendarConfig::SCOPES, $connection->scopes);
        $this->assertFalse($connection->requires_reauthentication);
        $this->assertNotNull($connection->expires_at);
        $this->assertTrue($connection->expires_at->isFuture());
    }

    public function test_callback_endpoint_stores_the_tokens_encrypted(): void
    {
        // Arrange
        $user = User::factory()->withPersonalOrganization()->create();
        $this->actingAs($user);
        Socialite::fake('google', $this->fakeGoogleUser());

        // Act
        $this->get(route('integrations.google-calendar.callback', ['code' => 'the-code']));

        // Assert
        $row = DB::table('google_calendar_connections')->where('user_id', '=', $user->getKey())->first();
        $this->assertNotNull($row);
        $this->assertIsString($row->access_token);
        $this->assertIsString($row->refresh_token);
        $this->assertStringNotContainsString('the-access-token', $row->access_token);
        $this->assertStringNotContainsString('the-refresh-token', $row->refresh_token);
    }

    public function test_callback_endpoint_replaces_an_existing_connection_and_clears_the_reauthentication_flag(): void
    {
        // Arrange
        $user = User::factory()->withPersonalOrganization()->create();
        $existingConnection = GoogleCalendarConnection::factory()->forUser($user)->requiresReauthentication()->create([
            'access_token' => 'old-access-token',
        ]);
        $this->actingAs($user);
        Socialite::fake('google', $this->fakeGoogleUser());

        // Act
        $response = $this->get(route('integrations.google-calendar.callback', ['code' => 'the-code']));

        // Assert
        $response->assertRedirect(route('profile.show'));
        $this->assertSame(1, GoogleCalendarConnection::query()->where('user_id', '=', $user->getKey())->count());
        $existingConnection->refresh();
        $this->assertSame('the-access-token', $existingConnection->access_token);
        $this->assertFalse($existingConnection->requires_reauthentication);
    }

    public function test_callback_endpoint_keeps_the_existing_refresh_token_if_google_does_not_return_one(): void
    {
        // Arrange
        $user = User::factory()->withPersonalOrganization()->create();
        $existingConnection = GoogleCalendarConnection::factory()->forUser($user)->create([
            'refresh_token' => 'the-original-refresh-token',
        ]);
        $this->actingAs($user);
        Socialite::fake('google', $this->fakeGoogleUser(refreshToken: null));

        // Act
        $this->get(route('integrations.google-calendar.callback', ['code' => 'the-code']));

        // Assert
        $this->assertSame('the-original-refresh-token', $existingConnection->refresh()->refresh_token);
    }

    public function test_callback_endpoint_redirects_with_an_error_if_the_user_denied_access(): void
    {
        // Arrange
        $user = User::factory()->withPersonalOrganization()->create();
        $this->actingAs($user);

        // Act
        $response = $this->get(route('integrations.google-calendar.callback', ['error' => 'access_denied']));

        // Assert
        $response->assertRedirect(route('profile.show'));
        $response->assertSessionHas('bannerStyle', 'danger');
        $this->assertSame(0, GoogleCalendarConnection::query()->count());
    }

    public function test_callback_endpoint_redirects_with_an_error_if_google_does_not_return_an_access_token(): void
    {
        // Arrange
        $user = User::factory()->withPersonalOrganization()->create();
        $this->actingAs($user);
        Socialite::fake('google', $this->fakeGoogleUser(token: ''));

        // Act
        $response = $this->get(route('integrations.google-calendar.callback', ['code' => 'the-code']));

        // Assert
        $response->assertRedirect(route('profile.show'));
        $response->assertSessionHas('bannerStyle', 'danger');
        $this->assertSame(0, GoogleCalendarConnection::query()->count());
    }

    public function test_callback_endpoint_does_not_touch_the_connection_of_another_user(): void
    {
        // Arrange
        $user = User::factory()->withPersonalOrganization()->create();
        $otherUser = User::factory()->withPersonalOrganization()->create();
        $otherConnection = GoogleCalendarConnection::factory()->forUser($otherUser)->create([
            'access_token' => 'other-users-access-token',
        ]);
        $this->actingAs($user);
        Socialite::fake('google', $this->fakeGoogleUser());

        // Act
        $this->get(route('integrations.google-calendar.callback', ['code' => 'the-code']));

        // Assert
        $this->assertSame('other-users-access-token', $otherConnection->refresh()->access_token);
        $this->assertSame(2, GoogleCalendarConnection::query()->count());
    }
}
