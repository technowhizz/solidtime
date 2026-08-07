<?php

declare(strict_types=1);

namespace App\Exceptions\Api;

class GoogleCalendarRequestFailedApiException extends ApiException
{
    public const string KEY = 'google_calendar_request_failed';
}
