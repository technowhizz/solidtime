<?php

declare(strict_types=1);

namespace Tests\Unit\Console;

use App\Console\Kernel;
use PHPUnit\Framework\Attributes\CoversClass;
use Tests\TestCase;

#[CoversClass(Kernel::class)]
class KernelTest extends TestCase
{
    public function test_schedule_contains_no_commands_that_contact_solidtime(): void
    {
        // Arrange
        config([
            'app.key' => 'base64:cOXN4GLMXYjcdG0fKosnFogofXw1pNoXkLAViRH+a5Y=',
        ]);

        // Act
        $schedule = app()->make(Kernel::class)->resolveConsoleSchedule();
        $events = collect($schedule->events())->filter(fn ($event) => str_contains($event->command, 'self-host:check-for-update') ||
            str_contains($event->command, 'self-host:telemetry')
        );

        // Assert
        $this->assertCount(0, $events);
    }

    public function test_schedule_contains_the_local_tasks(): void
    {
        // Act
        $schedule = app()->make(Kernel::class)->resolveConsoleSchedule();
        $commands = collect($schedule->events())->map(fn ($event) => $event->command);

        // Assert
        $this->assertCount(1, $commands->filter(fn (string $command) => str_contains($command, 'time-entry:send-still-running-mails')));
        $this->assertCount(1, $commands->filter(fn (string $command) => str_contains($command, 'auth:send-mails-expiring-api-tokens')));
    }
}
