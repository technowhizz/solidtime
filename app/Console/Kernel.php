<?php

declare(strict_types=1);

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    /**
     * Define the application's command schedule.
     */
    protected function schedule(Schedule $schedule): void
    {
        $schedule->command('time-entry:send-still-running-mails')
            ->when(fn (): bool => config('scheduling.tasks.time_entry_send_still_running_mails'))
            ->everyTenMinutes();

        $schedule->command('auth:send-mails-expiring-api-tokens')
            ->when(fn (): bool => config('scheduling.tasks.auth_send_mails_expiring_api_tokens'))
            ->everyTenMinutes();

        // This fork does not phone home. Upstream scheduled self-host:telemetry and
        // self-host:check-for-update here, which posted usage counts and this installation's
        // APP_URL to app.solidtime.io twice a day.

        $schedule->command('self-host:database-consistency')
            ->when(fn (): bool => config('scheduling.tasks.self_hosting_database_consistency'))
            ->everySixHours();
    }

    /**
     * Register the commands for the application.
     */
    protected function commands(): void
    {
        $this->load(__DIR__.'/Commands');
    }
}
