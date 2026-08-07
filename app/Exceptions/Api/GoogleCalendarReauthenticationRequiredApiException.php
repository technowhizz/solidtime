<?php

declare(strict_types=1);

namespace App\Exceptions\Api;

class GoogleCalendarReauthenticationRequiredApiException extends ApiException
{
    public const string KEY = 'google_calendar_reauthentication_required';
}
