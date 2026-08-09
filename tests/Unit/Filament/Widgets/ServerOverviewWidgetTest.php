<?php

declare(strict_types=1);

namespace Tests\Unit\Filament\Widgets;

use App\Filament\Widgets\ServerOverview;
use App\Models\User;
use Cache;
use Illuminate\Support\Facades\Config;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Unit\Filament\FilamentTestCase;

#[UsesClass(ServerOverview::class)]
class ServerOverviewWidgetTest extends FilamentTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Config::set('auth.super_admins', ['admin@example.com']);
        $user = User::factory()->withPersonalOrganization()->create([
            'email' => 'admin@example.com',
        ]);

        $this->actingAs($user);
    }

    public function test_shows_version_and_build(): void
    {
        // Arrange
        Config::set('app.version', '1.0.0');
        Config::set('app.build', 'ABC123');

        // Act
        $response = Livewire::test(ServerOverview::class);

        // Assert
        $response->assertSuccessful();
        $response->assertSee('1.0.0');
        $response->assertSee('ABC123');
    }

    public function test_does_not_show_whether_an_update_is_available(): void
    {
        // Arrange
        Config::set('app.version', '1.0.0');
        Config::set('app.build', 'ABC123');
        // Upstream filled this from a twice daily POST to app.solidtime.io. That call is gone,
        // so a stale value left over from before the upgrade must not resurface in the panel.
        Cache::put('latest_version', '1.0.1');

        // Act
        $response = Livewire::test(ServerOverview::class);

        // Assert
        $response->assertSuccessful();
        $response->assertDontSee('Update available');
        $response->assertDontSee('Current version');
        $response->assertDontSee('1.0.1');
    }
}
