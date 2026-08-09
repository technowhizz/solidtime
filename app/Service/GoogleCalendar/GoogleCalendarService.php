<?php

declare(strict_types=1);

namespace App\Service\GoogleCalendar;

use App\Exceptions\Api\GoogleCalendarReauthenticationRequiredApiException;
use App\Exceptions\Api\GoogleCalendarRequestFailedApiException;
use App\Models\GoogleCalendarConnection;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class GoogleCalendarService
{
    private const string CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3';

    private const string TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private const string REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

    private const int MAX_RESULTS_PER_PAGE = 250;

    /**
     * Upper bound on the pagination loop, so a misbehaving upstream can not keep a
     * request alive indefinitely. At 250 events per page this covers 2500 events.
     */
    private const int MAX_PAGES = 10;

    private const int TIMEOUT_SECONDS = 10;

    private const int CONNECT_TIMEOUT_SECONDS = 5;

    /**
     * How long a day of events is reused before Google is asked again. Short because the
     * per-day cache below means a refresh costs only the days actually missing, not the
     * whole three week window the calendar requests.
     */
    private const int DAY_CACHE_SECONDS = 15;

    public function __construct(private GoogleCalendarConfig $config) {}

    /**
     * Events overlapping the range, served from a cache keyed by whole UTC days.
     *
     * The calendar asks for the visible week plus one either side, so paging a week shifts
     * the requested range while two thirds of its days are unchanged. Caching against the
     * range itself misses entirely on that shift and refetches all 21 days; caching per day
     * turns it into one upstream call for the seven genuinely new ones.
     *
     * @return list<GoogleCalendarEventDto>
     *
     * @throws GoogleCalendarReauthenticationRequiredApiException
     * @throws GoogleCalendarRequestFailedApiException
     */
    public function cachedEventsForRange(GoogleCalendarConnection $connection, CarbonInterface $start, CarbonInterface $end): array
    {
        $days = $this->daysCovering($start, $end);
        if ($days === []) {
            return [];
        }

        /** @var array<string, list<GoogleCalendarEventDto>> $byDay */
        $byDay = [];
        $missing = [];

        foreach ($days as $day) {
            $hit = Cache::get($this->dayCacheKey($connection, $day));
            if (is_array($hit)) {
                /** @var list<GoogleCalendarEventDto> $hit */
                $byDay[$day] = $hit;
            } else {
                $missing[] = $day;
            }
        }

        if ($missing !== []) {
            // One upstream call spanning the missing days. In practice they are contiguous —
            // a week of navigation adds a run at one end — so this stays a single request.
            $fetched = $this->eventsForRange(
                $connection,
                CarbonImmutable::parse($missing[0], 'UTC'),
                CarbonImmutable::parse($missing[count($missing) - 1], 'UTC')->addDay()
            );

            foreach ($missing as $day) {
                $dayStart = CarbonImmutable::parse($day, 'UTC');
                $forDay = $this->eventsOverlapping($fetched, $dayStart, $dayStart->addDay());
                Cache::put($this->dayCacheKey($connection, $day), $forDay, self::DAY_CACHE_SECONDS);
                $byDay[$day] = $forDay;
            }
        }

        // An event that spans midnight sits in more than one day, so the union is deduplicated
        $unique = [];
        foreach ($byDay as $forDay) {
            foreach ($forDay as $event) {
                $unique[$event->id] = $event;
            }
        }

        $events = $this->eventsOverlapping(array_values($unique), $start, $end);
        usort($events, fn (GoogleCalendarEventDto $a, GoogleCalendarEventDto $b): int => $a->start <=> $b->start);

        return $events;
    }

    /**
     * Forget every cached day for a connection, so the next read goes back to Google.
     */
    public function forgetCachedEvents(GoogleCalendarConnection $connection, CarbonInterface $start, CarbonInterface $end): void
    {
        foreach ($this->daysCovering($start, $end) as $day) {
            Cache::forget($this->dayCacheKey($connection, $day));
        }
    }

    private function dayCacheKey(GoogleCalendarConnection $connection, string $day): string
    {
        return 'google-calendar:'.$connection->id.':day:'.$day;
    }

    /**
     * The whole UTC days the range touches. Day granularity is what makes the keys repeat
     * across navigation, since paging moves the range by whole days.
     *
     * @return list<string>
     */
    private function daysCovering(CarbonInterface $start, CarbonInterface $end): array
    {
        $day = $start->toImmutable()->utc()->startOfDay();
        $last = $end->toImmutable()->utc();

        $days = [];
        while ($day->isBefore($last)) {
            $days[] = $day->format('Y-m-d');
            $day = $day->addDay();
        }

        return $days;
    }

    /**
     * @param  list<GoogleCalendarEventDto>  $events
     * @return list<GoogleCalendarEventDto>
     */
    private function eventsOverlapping(array $events, CarbonInterface $start, CarbonInterface $end): array
    {
        return array_values(array_filter($events, function (GoogleCalendarEventDto $event) use ($start, $end): bool {
            // A zero length event still belongs to the day it starts on
            $effectiveEnd = $event->end->greaterThan($event->start) ? $event->end : $event->start->addSecond();

            return $event->start->isBefore($end) && $effectiveEnd->isAfter($start);
        }));
    }

    /**
     * Load the events of the user's primary calendar that overlap the given range.
     *
     * @return list<GoogleCalendarEventDto>
     *
     * @throws GoogleCalendarReauthenticationRequiredApiException
     * @throws GoogleCalendarRequestFailedApiException
     */
    public function eventsForRange(GoogleCalendarConnection $connection, CarbonInterface $start, CarbonInterface $end): array
    {
        $accessToken = $this->ensureFreshAccessToken($connection);

        $events = [];
        $pageToken = null;
        $page = 0;

        do {
            $query = [
                // Note: timeMin bounds the event end and timeMax bounds the event start,
                // so this returns everything that overlaps the range
                'timeMin' => $start->toIso8601ZuluString(),
                'timeMax' => $end->toIso8601ZuluString(),
                // Expand recurring events into their individual instances
                'singleEvents' => 'true',
                'orderBy' => 'startTime',
                'maxResults' => self::MAX_RESULTS_PER_PAGE,
            ];
            if ($pageToken !== null) {
                $query['pageToken'] = $pageToken;
            }

            $response = $this->send(fn (): Response => Http::asJson()
                ->withToken($accessToken)
                ->timeout(self::TIMEOUT_SECONDS)
                ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
                ->get(self::CALENDAR_API_URL.'/calendars/primary/events', $query));

            if ($response->status() === 401) {
                $this->markAsRequiringReauthentication($connection);

                throw new GoogleCalendarReauthenticationRequiredApiException;
            }

            if ($response->status() !== 200) {
                Log::warning('Failed to load Google Calendar events', [
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);

                throw new GoogleCalendarRequestFailedApiException;
            }

            $items = $response->json('items');
            if (is_array($items)) {
                foreach ($items as $item) {
                    if (! is_array($item)) {
                        continue;
                    }
                    $event = $this->mapEvent($item);
                    if ($event !== null) {
                        $events[] = $event;
                    }
                }
            }

            $nextPageToken = $response->json('nextPageToken');
            $pageToken = is_string($nextPageToken) && $nextPageToken !== '' ? $nextPageToken : null;
            $page++;
        } while ($pageToken !== null && $page < self::MAX_PAGES);

        return $events;
    }

    /**
     * Return a usable access token, refreshing the stored one first if it is about to expire.
     *
     * @throws GoogleCalendarReauthenticationRequiredApiException
     * @throws GoogleCalendarRequestFailedApiException
     */
    public function ensureFreshAccessToken(GoogleCalendarConnection $connection): string
    {
        if ($connection->requires_reauthentication) {
            throw new GoogleCalendarReauthenticationRequiredApiException;
        }

        if (! $connection->needsTokenRefresh()) {
            return $connection->access_token;
        }

        if ($connection->refresh_token === null) {
            $this->markAsRequiringReauthentication($connection);

            throw new GoogleCalendarReauthenticationRequiredApiException;
        }

        $response = $this->send(fn (): Response => Http::asForm()
            ->timeout(self::TIMEOUT_SECONDS)
            ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
            ->post(self::TOKEN_URL, [
                'grant_type' => 'refresh_token',
                'refresh_token' => $connection->refresh_token,
                'client_id' => $this->config->clientId(),
                'client_secret' => $this->config->clientSecret(),
            ]));

        if ($response->status() !== 200) {
            // A rejected refresh token is permanent, the user has to grant access again
            if ($response->json('error') === 'invalid_grant') {
                $this->markAsRequiringReauthentication($connection);

                throw new GoogleCalendarReauthenticationRequiredApiException;
            }

            Log::warning('Failed to refresh Google Calendar access token', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            throw new GoogleCalendarRequestFailedApiException;
        }

        $accessToken = $response->json('access_token');
        if (! is_string($accessToken) || $accessToken === '') {
            Log::warning('Google Calendar token refresh response did not contain an access token', [
                'status' => $response->status(),
            ]);

            throw new GoogleCalendarRequestFailedApiException;
        }

        $expiresIn = $response->json('expires_in');
        $connection->access_token = $accessToken;
        $connection->expires_at = is_int($expiresIn) ? Carbon::now()->addSeconds($expiresIn) : null;

        // Google does not reissue a refresh token on refresh, so the stored one is kept
        $refreshToken = $response->json('refresh_token');
        if (is_string($refreshToken) && $refreshToken !== '') {
            $connection->refresh_token = $refreshToken;
        }

        $connection->save();

        return $accessToken;
    }

    /**
     * Ask Google to drop the grant. Best effort - a failure here must not stop the user
     * from disconnecting locally.
     */
    public function revoke(GoogleCalendarConnection $connection): void
    {
        // Revoking the refresh token revokes the whole grant, including access tokens
        $token = $connection->refresh_token ?? $connection->access_token;

        try {
            $response = Http::asForm()
                ->timeout(self::TIMEOUT_SECONDS)
                ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
                ->post(self::REVOKE_URL, [
                    'token' => $token,
                ]);

            if ($response->status() !== 200) {
                Log::warning('Failed to revoke Google Calendar access', [
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);
            }
        } catch (Throwable $e) {
            Log::warning('Failed to revoke Google Calendar access', [
                'message' => $e->getMessage(),
            ]);
        }
    }

    /**
     * @param  callable(): Response  $callback
     *
     * @throws GoogleCalendarRequestFailedApiException
     */
    private function send(callable $callback): Response
    {
        try {
            return $callback();
        } catch (ConnectionException $e) {
            Log::warning('Could not reach Google Calendar', [
                'message' => $e->getMessage(),
            ]);

            throw new GoogleCalendarRequestFailedApiException;
        }
    }

    /**
     * @param  array<mixed>  $item
     */
    private function mapEvent(array $item): ?GoogleCalendarEventDto
    {
        if (($item['status'] ?? null) === 'cancelled') {
            return null;
        }

        $id = $item['id'] ?? null;
        if (! is_string($id) || $id === '') {
            return null;
        }

        $start = is_array($item['start'] ?? null) ? $item['start'] : [];
        $end = is_array($item['end'] ?? null) ? $item['end'] : [];

        $startDateTime = $start['dateTime'] ?? null;
        $endDateTime = $end['dateTime'] ?? null;

        // All-day events carry a date instead of a dateTime
        $isAllDay = ! is_string($startDateTime);

        try {
            if ($isAllDay) {
                $startDate = $start['date'] ?? null;
                $endDate = $end['date'] ?? null;
                if (! is_string($startDate) || ! is_string($endDate)) {
                    return null;
                }
                $startsAt = CarbonImmutable::parse($startDate, 'UTC')->startOfDay();
                $endsAt = CarbonImmutable::parse($endDate, 'UTC')->startOfDay();
            } else {
                if (! is_string($endDateTime)) {
                    return null;
                }
                // Google returns RFC3339 with an offset, solidtime works in UTC
                $startsAt = CarbonImmutable::parse($startDateTime)->utc();
                $endsAt = CarbonImmutable::parse($endDateTime)->utc();
            }
        } catch (Throwable $e) {
            Log::warning('Skipped Google Calendar event with an unparsable date', [
                'message' => $e->getMessage(),
            ]);

            return null;
        }

        $title = $item['summary'] ?? null;
        $htmlLink = $item['htmlLink'] ?? null;

        return new GoogleCalendarEventDto(
            $id,
            is_string($title) && trim($title) !== '' ? $title : '(No title)',
            $startsAt,
            $endsAt,
            $isAllDay,
            is_string($htmlLink) ? $htmlLink : null,
        );
    }

    private function markAsRequiringReauthentication(GoogleCalendarConnection $connection): void
    {
        $connection->requires_reauthentication = true;
        $connection->save();
    }
}
