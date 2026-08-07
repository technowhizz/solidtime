<?php

declare(strict_types=1);

namespace Tests\Unit\Endpoint\Api\V1;

use App\Exceptions\Api\GoogleCalendarNotConnectedApiException;
use App\Exceptions\Api\GoogleCalendarReauthenticationRequiredApiException;
use App\Http\Controllers\Api\V1\GoogleCalendarController;
use App\Models\GoogleCalendarConnection;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Laravel\Passport\Passport;
use PHPUnit\Framework\Attributes\UsesClass;

#[UsesClass(GoogleCalendarController::class)]
class GoogleCalendarEndpointTest extends ApiEndpointTestAbstract
{
    private const string EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events*';

    private const string REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.google.client_id' => 'test-client-id',
            'services.google.client_secret' => 'test-client-secret',
        ]);
    }

    public function test_show_endpoint_fails_if_user_is_not_authenticated(): void
    {
        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.show'));

        // Assert
        $response->assertUnauthorized();
    }

    public function test_show_endpoint_returns_not_connected_if_user_has_no_connection(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.show'));

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertExactJson([
            'data' => [
                'is_connected' => false,
                'email' => null,
                'requires_reauthentication' => false,
                'connected_at' => null,
            ],
        ]);
    }

    public function test_show_endpoint_returns_the_connection_of_the_current_user(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        $connection = GoogleCalendarConnection::factory()->forUser($data->user)->create([
            'email' => 'calendar-owner@example.com',
        ]);
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.show'));

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertExactJson([
            'data' => [
                'is_connected' => true,
                'email' => 'calendar-owner@example.com',
                'requires_reauthentication' => false,
                'connected_at' => $connection->created_at->toIso8601ZuluString(),
            ],
        ]);
    }

    public function test_show_endpoint_does_not_return_the_connection_of_another_user(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        $otherData = $this->createUserWithPermission([]);
        GoogleCalendarConnection::factory()->forUser($otherData->user)->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.show'));

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertJsonPath('data.is_connected', false);
    }

    public function test_show_endpoint_reports_that_reauthentication_is_required(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        GoogleCalendarConnection::factory()->forUser($data->user)->requiresReauthentication()->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.show'));

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertJsonPath('data.requires_reauthentication', true);
    }

    public function test_destroy_endpoint_fails_if_user_is_not_authenticated(): void
    {
        // Act
        $response = $this->deleteJson(route('api.v1.users.google-calendar.destroy'));

        // Assert
        $response->assertUnauthorized();
    }

    public function test_destroy_endpoint_revokes_the_access_at_google_and_deletes_the_connection(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        $connection = GoogleCalendarConnection::factory()->forUser($data->user)->create([
            'refresh_token' => 'the-refresh-token',
        ]);
        Http::fake([
            self::REVOKE_URL => Http::response(null, 200),
        ]);
        Passport::actingAs($data->user);

        // Act
        $response = $this->deleteJson(route('api.v1.users.google-calendar.destroy'));

        // Assert
        $this->assertResponseCode($response, 204);
        $this->assertDatabaseMissing('google_calendar_connections', [
            'id' => $connection->getKey(),
        ]);
        Http::assertSent(function (Request $request): bool {
            return $request->url() === self::REVOKE_URL
                && $request['token'] === 'the-refresh-token';
        });
    }

    public function test_destroy_endpoint_does_not_delete_the_connection_of_another_user(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        $otherData = $this->createUserWithPermission([]);
        $otherConnection = GoogleCalendarConnection::factory()->forUser($otherData->user)->create();
        Http::fake();
        Passport::actingAs($data->user);

        // Act
        $response = $this->deleteJson(route('api.v1.users.google-calendar.destroy'));

        // Assert
        $this->assertResponseCode($response, 204);
        $this->assertDatabaseHas('google_calendar_connections', [
            'id' => $otherConnection->getKey(),
        ]);
        Http::assertNothingSent();
    }

    public function test_events_endpoint_fails_if_user_is_not_authenticated(): void
    {
        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.events', [
            'start' => '2026-08-03T00:00:00Z',
            'end' => '2026-08-10T00:00:00Z',
        ]));

        // Assert
        $response->assertUnauthorized();
    }

    public function test_events_endpoint_returns_the_events_of_the_connected_calendar(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        GoogleCalendarConnection::factory()->forUser($data->user)->create();
        Http::fake([
            self::EVENTS_URL => Http::response([
                'items' => [
                    [
                        'id' => 'event-1',
                        'summary' => 'Sprint planning',
                        'htmlLink' => 'https://calendar.google.com/event?eid=1',
                        'start' => ['dateTime' => '2026-08-04T10:00:00+02:00'],
                        'end' => ['dateTime' => '2026-08-04T11:30:00+02:00'],
                    ],
                ],
            ], 200),
        ]);
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.events', [
            'start' => '2026-08-03T00:00:00Z',
            'end' => '2026-08-10T00:00:00Z',
        ]));

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertExactJson([
            'data' => [
                [
                    'id' => 'event-1',
                    'title' => 'Sprint planning',
                    'start' => '2026-08-04T08:00:00Z',
                    'end' => '2026-08-04T09:30:00Z',
                    'is_all_day' => false,
                    'html_link' => 'https://calendar.google.com/event?eid=1',
                ],
            ],
        ]);
    }

    public function test_events_endpoint_fails_if_user_has_no_connection(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.events', [
            'start' => '2026-08-03T00:00:00Z',
            'end' => '2026-08-10T00:00:00Z',
        ]));

        // Assert
        $response->assertStatus(400);
        $response->assertJsonPath('error', true);
        $response->assertJsonPath('key', GoogleCalendarNotConnectedApiException::KEY);
    }

    public function test_events_endpoint_fails_if_the_connection_requires_reauthentication(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        GoogleCalendarConnection::factory()->forUser($data->user)->requiresReauthentication()->create();
        Http::fake();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.events', [
            'start' => '2026-08-03T00:00:00Z',
            'end' => '2026-08-10T00:00:00Z',
        ]));

        // Assert
        $response->assertStatus(400);
        $response->assertJsonPath('error', true);
        $response->assertJsonPath('key', GoogleCalendarReauthenticationRequiredApiException::KEY);
    }

    public function test_events_endpoint_fails_if_range_is_missing(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        GoogleCalendarConnection::factory()->forUser($data->user)->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.events'));

        // Assert
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['start', 'end']);
    }

    public function test_events_endpoint_fails_if_range_has_the_wrong_format(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        GoogleCalendarConnection::factory()->forUser($data->user)->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.events', [
            'start' => '2026-08-03T00:00:00+02:00',
            'end' => '2026-08-10T00:00:00Z',
        ]));

        // Assert
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['start']);
    }

    public function test_events_endpoint_fails_if_range_is_longer_than_the_maximum(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        GoogleCalendarConnection::factory()->forUser($data->user)->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.events', [
            'start' => '2026-01-01T00:00:00Z',
            'end' => '2026-12-31T00:00:00Z',
        ]));

        // Assert
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['end']);
    }

    public function test_events_endpoint_fails_if_end_is_before_start(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        GoogleCalendarConnection::factory()->forUser($data->user)->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.users.google-calendar.events', [
            'start' => '2026-08-10T00:00:00Z',
            'end' => '2026-08-03T00:00:00Z',
        ]));

        // Assert
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['start']);
    }

    public function test_events_endpoint_caches_the_response_for_the_same_range(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        GoogleCalendarConnection::factory()->forUser($data->user)->create();
        Http::fake([
            self::EVENTS_URL => Http::response(['items' => []], 200),
        ]);
        Passport::actingAs($data->user);
        $query = [
            'start' => '2026-08-03T00:00:00Z',
            'end' => '2026-08-10T00:00:00Z',
        ];

        // Act
        $this->getJson(route('api.v1.users.google-calendar.events', $query));
        $response = $this->getJson(route('api.v1.users.google-calendar.events', $query));

        // Assert
        $this->assertResponseCode($response, 200);
        Http::assertSentCount(1);
    }
}
