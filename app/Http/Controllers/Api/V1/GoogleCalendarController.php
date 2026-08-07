<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

use App\Exceptions\Api\GoogleCalendarNotConnectedApiException;
use App\Exceptions\Api\GoogleCalendarReauthenticationRequiredApiException;
use App\Exceptions\Api\GoogleCalendarRequestFailedApiException;
use App\Http\Requests\V1\GoogleCalendar\GoogleCalendarEventIndexRequest;
use App\Http\Resources\V1\GoogleCalendar\GoogleCalendarConnectionResource;
use App\Http\Resources\V1\GoogleCalendar\GoogleCalendarEventCollection;
use App\Http\Resources\V1\GoogleCalendar\GoogleCalendarEventResource;
use App\Service\GoogleCalendar\GoogleCalendarEventDto;
use App\Service\GoogleCalendar\GoogleCalendarService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

class GoogleCalendarController extends Controller
{
    /**
     * How long an events response is reused before Google is asked again.
     */
    private const int EVENTS_CACHE_SECONDS = 60;

    /**
     * Get the Google Calendar connection of the currently authenticated user
     *
     * This endpoint is independent of the organization. A user without a connection gets
     * `is_connected` false instead of a 404.
     *
     * @operationId getGoogleCalendarConnection
     *
     * @throws AuthorizationException
     */
    public function show(): GoogleCalendarConnectionResource
    {
        $user = $this->user();

        return new GoogleCalendarConnectionResource($user->googleCalendarConnection()->first());
    }

    /**
     * Disconnect the Google Calendar account of the currently authenticated user
     *
     * The access is revoked at Google and the stored credentials are deleted.
     *
     * @operationId deleteGoogleCalendarConnection
     *
     * @throws AuthorizationException
     */
    public function destroy(): JsonResponse
    {
        $user = $this->user();

        $connection = $user->googleCalendarConnection()->first();

        if ($connection !== null) {
            app(GoogleCalendarService::class)->revoke($connection);
            $connection->delete();
        }

        return response()->json(null, 204);
    }

    /**
     * Get the Google Calendar events of the currently authenticated user
     *
     * Returns the events of the primary calendar that overlap the given range. Event content is
     * never stored by solidtime, it is fetched from Google per request.
     *
     * @return GoogleCalendarEventCollection<GoogleCalendarEventResource>
     *
     * @throws AuthorizationException
     * @throws GoogleCalendarNotConnectedApiException
     * @throws GoogleCalendarReauthenticationRequiredApiException
     * @throws GoogleCalendarRequestFailedApiException
     *
     * @operationId getGoogleCalendarEvents
     */
    public function events(GoogleCalendarEventIndexRequest $request): GoogleCalendarEventCollection
    {
        $user = $this->user();

        $connection = $user->googleCalendarConnection()->first();
        if ($connection === null) {
            throw new GoogleCalendarNotConnectedApiException;
        }

        $start = $request->getStart();
        $end = $request->getEnd();

        /** @var list<GoogleCalendarEventDto> $events */
        $events = Cache::remember(
            'google-calendar:'.$connection->id.':'.$start->toIso8601ZuluString().':'.$end->toIso8601ZuluString(),
            self::EVENTS_CACHE_SECONDS,
            fn (): array => app(GoogleCalendarService::class)->eventsForRange($connection, $start, $end)
        );

        return new GoogleCalendarEventCollection($events);
    }
}
