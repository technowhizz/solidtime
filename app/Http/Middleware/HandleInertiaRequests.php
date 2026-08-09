<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Service\BillingContract;
use App\Service\GoogleCalendar\GoogleCalendarConfig;
use App\Service\Jira\JiraConfig;
use Illuminate\Http\Request;
use Inertia\Middleware;
use Nwidart\Modules\Facades\Module;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Defines the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $hasBilling = Module::has('Billing') && Module::isEnabled('Billing');
        $hasInvoicing = Module::has('Invoicing') && Module::isEnabled('Invoicing');
        $hasServices = Module::has('Services') && Module::isEnabled('Services');

        /** @var BillingContract $billing */
        $billing = app(BillingContract::class);

        $currentOrganization = $request->user()?->currentOrganization;

        return array_merge(parent::share($request), [
            // Single source of truth for the product name in the UI, so renaming the app is a
            // one line change rather than a hunt through every Vue file
            'app_name' => config('app.name'),
            'has_billing_extension' => $hasBilling,
            'has_invoicing_extension' => $hasInvoicing,
            'has_services_extension' => $hasServices,
            'google_calendar_enabled' => app(GoogleCalendarConfig::class)->isConfigured(),
            // Per organization rather than per installation: an admin points it at their Jira
            // site, and members of an organization without one never see the integration
            'jira_enabled' => $currentOrganization !== null && app(JiraConfig::class)->isConfigured($currentOrganization),
            'billing' => $currentOrganization !== null ? [
                'has_subscription' => $billing->hasSubscription($currentOrganization),
                'has_trial' => $billing->hasTrial($currentOrganization),
                'trial_until' => $billing->getTrialUntil($currentOrganization)?->toIso8601ZuluString(),
                'is_blocked' => $billing->isBlocked($currentOrganization),
            ] : null,
            'flash' => [
                'message' => fn () => $request->session()->get('message'),
                'bannerText' => fn () => $request->session()->get('bannerText'),
                'bannerStyle' => fn () => $request->session()->get('bannerStyle'),
            ],
        ]);
    }
}
