<?php

declare(strict_types=1);

namespace Tests\Unit\Service\GoogleCalendar;

use App\Exceptions\Api\GoogleCalendarReauthenticationRequiredApiException;
use App\Exceptions\Api\GoogleCalendarRequestFailedApiException;
use App\Models\GoogleCalendarConnection;
use App\Service\GoogleCalendar\GoogleCalendarService;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\CoversClass;
use Tests\TestCaseWithDatabase;

#[CoversClass(GoogleCalendarService::class)]
class GoogleCalendarServiceTest extends TestCaseWithDatabase
{
    private const string EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events*';

    private const string TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private const string REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.google.client_id' => 'test-client-id',
            'services.google.client_secret' => 'test-client-secret',
        ]);
    }

    private function service(): GoogleCalendarService
    {
        return app(GoogleCalendarService::class);
    }

    private function rangeStart(): CarbonImmutable
    {
        return CarbonImmutable::parse('2026-08-03T00:00:00Z');
    }

    private function rangeEnd(): CarbonImmutable
    {
        return CarbonImmutable::parse('2026-08-10T00:00:00Z');
    }

    public function test_events_for_range_maps_timed_events_to_dtos(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create();
        Http::fake([
            self::EVENTS_URL => Http::response([
                'items' => [
                    [
                        'id' => 'event-1',
                        'status' => 'confirmed',
                        'summary' => 'Sprint planning',
                        'htmlLink' => 'https://calendar.google.com/event?eid=1',
                        'start' => ['dateTime' => '2026-08-04T10:00:00+02:00'],
                        'end' => ['dateTime' => '2026-08-04T11:30:00+02:00'],
                    ],
                ],
            ], 200),
        ]);

        // Act
        $events = $this->service()->eventsForRange($connection, $this->rangeStart(), $this->rangeEnd());

        // Assert
        $this->assertCount(1, $events);
        $this->assertSame('event-1', $events[0]->id);
        $this->assertSame('Sprint planning', $events[0]->title);
        $this->assertSame('2026-08-04T08:00:00Z', $events[0]->start->toIso8601ZuluString());
        $this->assertSame('2026-08-04T09:30:00Z', $events[0]->end->toIso8601ZuluString());
        $this->assertFalse($events[0]->isAllDay);
        $this->assertSame('https://calendar.google.com/event?eid=1', $events[0]->htmlLink);
    }

    public function test_events_for_range_sends_the_expected_query_and_bearer_token(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create([
            'access_token' => 'the-access-token',
        ]);
        Http::fake([
            self::EVENTS_URL => Http::response(['items' => []], 200),
        ]);

        // Act
        $this->service()->eventsForRange($connection, $this->rangeStart(), $this->rangeEnd());

        // Assert
        Http::assertSent(function (Request $request): bool {
            return $request->hasHeader('Authorization', 'Bearer the-access-token')
                && $request['timeMin'] === '2026-08-03T00:00:00Z'
                && $request['timeMax'] === '2026-08-10T00:00:00Z'
                && $request['singleEvents'] === 'true'
                && $request['orderBy'] === 'startTime';
        });
    }

    public function test_events_for_range_flags_all_day_events(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create();
        Http::fake([
            self::EVENTS_URL => Http::response([
                'items' => [
                    [
                        'id' => 'all-day-1',
                        'summary' => 'Company offsite',
                        'start' => ['date' => '2026-08-05'],
                        'end' => ['date' => '2026-08-06'],
                    ],
                ],
            ], 200),
        ]);

        // Act
        $events = $this->service()->eventsForRange($connection, $this->rangeStart(), $this->rangeEnd());

        // Assert
        $this->assertCount(1, $events);
        $this->assertTrue($events[0]->isAllDay);
        $this->assertSame('2026-08-05T00:00:00Z', $events[0]->start->toIso8601ZuluString());
        $this->assertSame('2026-08-06T00:00:00Z', $events[0]->end->toIso8601ZuluString());
    }

    public function test_events_for_range_skips_cancelled_events(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create();
        Http::fake([
            self::EVENTS_URL => Http::response([
                'items' => [
                    [
                        'id' => 'cancelled-1',
                        'status' => 'cancelled',
                        'summary' => 'Cancelled meeting',
                        'start' => ['dateTime' => '2026-08-04T10:00:00Z'],
                        'end' => ['dateTime' => '2026-08-04T11:00:00Z'],
                    ],
                    [
                        'id' => 'confirmed-1',
                        'status' => 'confirmed',
                        'summary' => 'Real meeting',
                        'start' => ['dateTime' => '2026-08-04T12:00:00Z'],
                        'end' => ['dateTime' => '2026-08-04T13:00:00Z'],
                    ],
                ],
            ], 200),
        ]);

        // Act
        $events = $this->service()->eventsForRange($connection, $this->rangeStart(), $this->rangeEnd());

        // Assert
        $this->assertCount(1, $events);
        $this->assertSame('confirmed-1', $events[0]->id);
    }

    public function test_events_for_range_falls_back_to_a_placeholder_title_for_events_without_a_summary(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create();
        Http::fake([
            self::EVENTS_URL => Http::response([
                'items' => [
                    [
                        'id' => 'no-title',
                        'start' => ['dateTime' => '2026-08-04T10:00:00Z'],
                        'end' => ['dateTime' => '2026-08-04T11:00:00Z'],
                    ],
                ],
            ], 200),
        ]);

        // Act
        $events = $this->service()->eventsForRange($connection, $this->rangeStart(), $this->rangeEnd());

        // Assert
        $this->assertCount(1, $events);
        $this->assertSame('(No title)', $events[0]->title);
    }

    public function test_events_for_range_follows_the_next_page_token(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create();
        Http::fake([
            self::EVENTS_URL => Http::sequence()
                ->push([
                    'items' => [
                        [
                            'id' => 'page-1-event',
                            'summary' => 'First page',
                            'start' => ['dateTime' => '2026-08-04T10:00:00Z'],
                            'end' => ['dateTime' => '2026-08-04T11:00:00Z'],
                        ],
                    ],
                    'nextPageToken' => 'token-for-page-2',
                ], 200)
                ->push([
                    'items' => [
                        [
                            'id' => 'page-2-event',
                            'summary' => 'Second page',
                            'start' => ['dateTime' => '2026-08-05T10:00:00Z'],
                            'end' => ['dateTime' => '2026-08-05T11:00:00Z'],
                        ],
                    ],
                ], 200),
        ]);

        // Act
        $events = $this->service()->eventsForRange($connection, $this->rangeStart(), $this->rangeEnd());

        // Assert
        $this->assertCount(2, $events);
        $this->assertSame('page-1-event', $events[0]->id);
        $this->assertSame('page-2-event', $events[1]->id);
        Http::assertSent(function (Request $request): bool {
            return ($request->data()['pageToken'] ?? null) === 'token-for-page-2';
        });
    }

    public function test_events_for_range_throws_request_failed_exception_on_error_response(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create();
        Http::fake([
            self::EVENTS_URL => Http::response(['error' => ['message' => 'Backend error']], 500),
        ]);

        // Assert
        $this->expectException(GoogleCalendarRequestFailedApiException::class);

        // Act
        $this->service()->eventsForRange($connection, $this->rangeStart(), $this->rangeEnd());
    }

    public function test_events_for_range_throws_request_failed_exception_on_connection_error(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create();
        Http::fake([
            self::EVENTS_URL => function (): void {
                throw new ConnectionException('Connection timed out');
            },
        ]);

        // Assert
        $this->expectException(GoogleCalendarRequestFailedApiException::class);

        // Act
        $this->service()->eventsForRange($connection, $this->rangeStart(), $this->rangeEnd());
    }

    public function test_events_for_range_marks_connection_for_reauthentication_on_unauthorized_response(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create();
        Http::fake([
            self::EVENTS_URL => Http::response(['error' => ['message' => 'Invalid Credentials']], 401),
        ]);

        // Act
        $exception = null;
        try {
            $this->service()->eventsForRange($connection, $this->rangeStart(), $this->rangeEnd());
        } catch (GoogleCalendarReauthenticationRequiredApiException $e) {
            $exception = $e;
        }

        // Assert
        $this->assertNotNull($exception);
        $this->assertTrue($connection->refresh()->requires_reauthentication);
    }

    public function test_ensure_fresh_access_token_returns_the_stored_token_if_it_is_still_valid(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create([
            'access_token' => 'still-valid',
        ]);
        Http::fake();

        // Act
        $token = $this->service()->ensureFreshAccessToken($connection);

        // Assert
        $this->assertSame('still-valid', $token);
        Http::assertNothingSent();
    }

    public function test_ensure_fresh_access_token_refreshes_and_persists_an_expired_token(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->expired()->create([
            'access_token' => 'old-access-token',
            'refresh_token' => 'the-refresh-token',
        ]);
        Http::fake([
            self::TOKEN_URL => Http::response([
                'access_token' => 'new-access-token',
                'expires_in' => 3599,
            ], 200),
        ]);

        // Act
        $token = $this->service()->ensureFreshAccessToken($connection);

        // Assert
        $this->assertSame('new-access-token', $token);
        $connection->refresh();
        $this->assertSame('new-access-token', $connection->access_token);
        $this->assertNotNull($connection->expires_at);
        $this->assertTrue($connection->expires_at->isFuture());
        Http::assertSent(function (Request $request): bool {
            return $request->url() === self::TOKEN_URL
                && $request['grant_type'] === 'refresh_token'
                && $request['refresh_token'] === 'the-refresh-token'
                && $request['client_id'] === 'test-client-id'
                && $request['client_secret'] === 'test-client-secret';
        });
    }

    public function test_ensure_fresh_access_token_keeps_the_stored_refresh_token_if_google_does_not_return_one(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->expired()->create([
            'refresh_token' => 'the-original-refresh-token',
        ]);
        Http::fake([
            self::TOKEN_URL => Http::response([
                'access_token' => 'new-access-token',
                'expires_in' => 3599,
            ], 200),
        ]);

        // Act
        $this->service()->ensureFreshAccessToken($connection);

        // Assert
        $this->assertSame('the-original-refresh-token', $connection->refresh()->refresh_token);
    }

    public function test_ensure_fresh_access_token_marks_connection_for_reauthentication_on_invalid_grant(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->expired()->create([
            'refresh_token' => 'revoked-refresh-token',
        ]);
        Http::fake([
            self::TOKEN_URL => Http::response(['error' => 'invalid_grant'], 400),
        ]);

        // Act
        $exception = null;
        try {
            $this->service()->ensureFreshAccessToken($connection);
        } catch (GoogleCalendarReauthenticationRequiredApiException $e) {
            $exception = $e;
        }

        // Assert
        $this->assertNotNull($exception);
        $this->assertTrue($connection->refresh()->requires_reauthentication);
    }

    public function test_ensure_fresh_access_token_marks_connection_for_reauthentication_without_a_refresh_token(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->expired()->withoutRefreshToken()->create();
        Http::fake();

        // Act
        $exception = null;
        try {
            $this->service()->ensureFreshAccessToken($connection);
        } catch (GoogleCalendarReauthenticationRequiredApiException $e) {
            $exception = $e;
        }

        // Assert
        $this->assertNotNull($exception);
        $this->assertTrue($connection->refresh()->requires_reauthentication);
        Http::assertNothingSent();
    }

    public function test_ensure_fresh_access_token_throws_immediately_if_the_connection_already_requires_reauthentication(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->requiresReauthentication()->create();
        Http::fake();

        // Assert
        $this->expectException(GoogleCalendarReauthenticationRequiredApiException::class);

        // Act
        $this->service()->ensureFreshAccessToken($connection);
    }

    public function test_ensure_fresh_access_token_throws_request_failed_exception_on_other_errors(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->expired()->create();
        Http::fake([
            self::TOKEN_URL => Http::response(['error' => 'internal_failure'], 500),
        ]);

        // Assert
        $this->expectException(GoogleCalendarRequestFailedApiException::class);

        // Act
        $this->service()->ensureFreshAccessToken($connection);
    }

    public function test_revoke_sends_the_refresh_token_to_the_revocation_endpoint(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create([
            'refresh_token' => 'the-refresh-token',
        ]);
        Http::fake([
            self::REVOKE_URL => Http::response(null, 200),
        ]);

        // Act
        $this->service()->revoke($connection);

        // Assert
        Http::assertSent(function (Request $request): bool {
            return $request->url() === self::REVOKE_URL
                && $request['token'] === 'the-refresh-token';
        });
    }

    public function test_revoke_does_not_throw_if_google_rejects_the_request(): void
    {
        // Arrange
        $connection = GoogleCalendarConnection::factory()->create();
        Http::fake([
            self::REVOKE_URL => Http::response(['error' => 'invalid_token'], 400),
        ]);

        // Act
        $this->service()->revoke($connection);

        // Assert
        Http::assertSentCount(1);
    }
}
