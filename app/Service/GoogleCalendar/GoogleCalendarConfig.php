<?php

declare(strict_types=1);

namespace App\Service\GoogleCalendar;

class GoogleCalendarConfig
{
    /**
     * The OAuth scopes solidtime asks Google for.
     *
     * Read-only and events-only on purpose: no write access, no calendar list, no profile.
     * The email scope is only there so the settings card can show which account is linked.
     *
     * @var list<string>
     */
    public const array SCOPES = [
        'https://www.googleapis.com/auth/calendar.events.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
    ];

    /**
     * Whether an operator has configured a Google OAuth client.
     *
     * Everything user facing gates on this, so a self-hosted installation without a
     * Google Cloud project never sees the integration.
     */
    public function isConfigured(): bool
    {
        return $this->clientId() !== null && $this->clientSecret() !== null;
    }

    public function clientId(): ?string
    {
        $clientId = config('services.google.client_id');

        return is_string($clientId) && $clientId !== '' ? $clientId : null;
    }

    public function clientSecret(): ?string
    {
        $clientSecret = config('services.google.client_secret');

        return is_string($clientSecret) && $clientSecret !== '' ? $clientSecret : null;
    }
}
