<?php

declare(strict_types=1);

return [
    'gotenberg' => [
        'url' => env('GOTENBERG_URL'),
        'basic_auth_username' => env('GOTENBERG_BASIC_AUTH_USERNAME'),
        'basic_auth_password' => env('GOTENBERG_BASIC_AUTH_PASSWORD'),
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        // Socialite resolves a relative redirect against APP_URL
        'redirect' => '/integrations/google-calendar/callback',
    ],
];
