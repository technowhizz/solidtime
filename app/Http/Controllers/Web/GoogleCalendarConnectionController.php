<?php

declare(strict_types=1);

namespace App\Http\Controllers\Web;

use App\Models\GoogleCalendarConnection;
use App\Service\GoogleCalendar\GoogleCalendarConfig;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\GoogleProvider;
use Laravel\Socialite\Two\User as SocialiteUser;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirectResponse;
use Throwable;

class GoogleCalendarConnectionController extends Controller
{
    /**
     * Send the user to Google to authorize read-only access to their calendar events.
     */
    public function connect(): SymfonyRedirectResponse
    {
        $this->abortIfNotConfigured();

        /** @var GoogleProvider $driver */
        $driver = Socialite::driver('google');

        return $driver
            // setScopes overwrites, scopes would merge with Socialite's "openid profile email" default
            ->setScopes(GoogleCalendarConfig::SCOPES)
            ->with([
                // Offline access is what yields a refresh token at all, and forcing the consent
                // screen is what makes Google reliably return one on repeat authorizations
                'access_type' => 'offline',
                'prompt' => 'consent',
            ])
            ->redirect();
    }

    /**
     * Store the credentials Google handed back and return the user to their profile.
     */
    public function callback(Request $request): RedirectResponse
    {
        $this->abortIfNotConfigured();

        $user = $this->user();

        if ($request->has('error')) {
            return redirect(route('profile.show'))
                ->with('bannerStyle', 'danger')
                ->with('bannerText', __('Connecting your Google account was cancelled.'));
        }

        try {
            $googleUser = Socialite::driver('google')->user();
        } catch (Throwable $e) {
            report($e);

            return redirect(route('profile.show'))
                ->with('bannerStyle', 'danger')
                ->with('bannerText', __('Connecting your Google account failed, please try again.'));
        }

        if (! ($googleUser instanceof SocialiteUser) || blank($googleUser->token)) {
            return redirect(route('profile.show'))
                ->with('bannerStyle', 'danger')
                ->with('bannerText', __('Connecting your Google account failed, please try again.'));
        }

        $existingConnection = $user->googleCalendarConnection()->first();

        // Google omits the refresh token when it decides the previous grant still covers the
        // request, so an existing one must survive a reconnect
        $refreshToken = filled($googleUser->refreshToken)
            ? $googleUser->refreshToken
            : $existingConnection?->refresh_token;

        // Note: the granted scopes do not include "openid", so Google is not obliged to return
        // an account identifier here - the column is nullable for exactly that reason
        $googleUserId = (string) $googleUser->getId();

        GoogleCalendarConnection::query()->updateOrCreate([
            'user_id' => $user->getKey(),
        ], [
            'google_user_id' => $googleUserId !== '' ? $googleUserId : null,
            'email' => $googleUser->getEmail(),
            'access_token' => $googleUser->token,
            'refresh_token' => $refreshToken,
            'expires_at' => filled($googleUser->expiresIn) ? Carbon::now()->addSeconds($googleUser->expiresIn) : null,
            'scopes' => array_values(array_filter($googleUser->approvedScopes, 'is_string')),
            'requires_reauthentication' => false,
        ]);

        return redirect(route('profile.show'))
            ->with('bannerStyle', 'success')
            ->with('bannerText', __('Your Google Calendar account has been connected.'));
    }

    /**
     * The routes are registered unconditionally so route names always resolve, but they only
     * do anything once an operator has configured a Google OAuth client.
     */
    private function abortIfNotConfigured(): void
    {
        if (! app(GoogleCalendarConfig::class)->isConfigured()) {
            abort(404);
        }
    }
}
