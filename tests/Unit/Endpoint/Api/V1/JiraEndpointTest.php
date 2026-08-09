<?php

declare(strict_types=1);

namespace Tests\Unit\Endpoint\Api\V1;

use App\Http\Controllers\Api\V1\JiraController;
use App\Jobs\SyncJiraWorklogs;
use App\Models\JiraConnection;
use App\Models\Member;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Laravel\Passport\Passport;
use PHPUnit\Framework\Attributes\UsesClass;

#[UsesClass(JiraController::class)]
class JiraEndpointTest extends ApiEndpointTestAbstract
{
    private const string SITE_URL = 'https://acme.atlassian.net';

    private const string MYSELF_URL = 'https://acme.atlassian.net/rest/api/3/myself';

    /**
     * @return object{user: User, organization: Organization, member: Member, owner: User, ownerMember: Member}
     */
    private function configuredOrganization(bool $withSite = true): object
    {
        $data = $this->createUserWithPermission(['time-entries:view:own']);
        $data->organization->jira_site_url = $withSite ? self::SITE_URL : null;
        $data->organization->save();
        $data->user->timezone = 'UTC';
        $data->user->save();

        return $data;
    }

    public function test_show_endpoint_fails_if_user_is_not_authenticated(): void
    {
        // Arrange
        $data = $this->configuredOrganization();

        // Act
        $response = $this->getJson(route('api.v1.jira.show', ['organization' => $data->organization->getKey()]));

        // Assert
        $response->assertUnauthorized();
    }

    public function test_show_endpoint_fails_if_user_has_no_permission(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([]);
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.jira.show', ['organization' => $data->organization->getKey()]));

        // Assert
        $response->assertForbidden();
    }

    public function test_show_endpoint_reports_not_configured_when_the_organization_has_no_site(): void
    {
        // Arrange
        $data = $this->configuredOrganization(withSite: false);
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.jira.show', ['organization' => $data->organization->getKey()]));

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertJsonPath('data.is_configured', false);
        $response->assertJsonPath('data.is_connected', false);
        $response->assertJsonPath('data.site_url', null);
    }

    public function test_show_endpoint_reports_configured_but_not_connected(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.jira.show', ['organization' => $data->organization->getKey()]));

        // Assert
        $response->assertJsonPath('data.is_configured', true);
        $response->assertJsonPath('data.site_url', self::SITE_URL);
        $response->assertJsonPath('data.is_connected', false);
    }

    public function test_update_endpoint_verifies_the_credentials_before_storing_them(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        Passport::actingAs($data->user);
        Http::fake([self::MYSELF_URL => Http::response([
            'accountId' => 'account-1',
            'displayName' => 'Sam Doe',
            'emailAddress' => 'sam@acme.test',
        ])]);

        // Act
        $response = $this->putJson(route('api.v1.jira.update', ['organization' => $data->organization->getKey()]), [
            'email' => 'sam@acme.test',
            'api_token' => 'a-real-token',
        ]);

        // Assert
        // 201 because the connection did not exist yet - reconnecting returns 200
        $this->assertResponseCode($response, 201);
        $response->assertJsonPath('data.is_connected', true);
        $response->assertJsonPath('data.display_name', 'Sam Doe');
        // The token is never handed back to the client
        $response->assertJsonMissingPath('data.api_token');
        $this->assertDatabaseHas('jira_connections', [
            'user_id' => $data->user->getKey(),
            'organization_id' => $data->organization->getKey(),
            'email' => 'sam@acme.test',
        ]);
        Http::assertSent(static fn (Request $request): bool => $request->hasHeader('Authorization'));
    }

    public function test_update_endpoint_replaces_the_token_when_reconnecting(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        JiraConnection::factory()->forUser($data->user)->forOrganization($data->organization)->requiresReauthentication()->create();
        Passport::actingAs($data->user);
        Http::fake([self::MYSELF_URL => Http::response([
            'accountId' => 'account-1',
            'displayName' => 'Sam Doe',
            'emailAddress' => 'sam@acme.test',
        ])]);

        // Act
        $response = $this->putJson(route('api.v1.jira.update', ['organization' => $data->organization->getKey()]), [
            'email' => 'sam@acme.test',
            'api_token' => 'a-fresh-token',
        ]);

        // Assert
        $this->assertResponseCode($response, 200);
        // One connection per user and organization, and reconnecting clears the warning
        $this->assertDatabaseCount('jira_connections', 1);
        $connection = JiraConnection::query()->firstOrFail();
        $this->assertFalse($connection->requires_reauthentication);
        $this->assertSame('a-fresh-token', $connection->api_token);
    }

    public function test_update_endpoint_stores_nothing_when_jira_rejects_the_token(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        Passport::actingAs($data->user);
        Http::fake([self::MYSELF_URL => Http::response([], 401)]);

        // Act
        $response = $this->putJson(route('api.v1.jira.update', ['organization' => $data->organization->getKey()]), [
            'email' => 'sam@acme.test',
            'api_token' => 'wrong-token',
        ]);

        // Assert
        $this->assertResponseCode($response, 400);
        $response->assertJsonPath('key', 'jira_authentication_failed');
        $this->assertDatabaseCount('jira_connections', 0);
    }

    public function test_update_endpoint_fails_when_the_organization_has_no_site(): void
    {
        // Arrange
        $data = $this->configuredOrganization(withSite: false);
        Passport::actingAs($data->user);

        // Act
        $response = $this->putJson(route('api.v1.jira.update', ['organization' => $data->organization->getKey()]), [
            'email' => 'sam@acme.test',
            'api_token' => 'a-real-token',
        ]);

        // Assert
        $this->assertResponseCode($response, 400);
        $response->assertJsonPath('key', 'jira_not_configured');
    }

    public function test_update_settings_endpoint_stores_the_sync_cutoff(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        JiraConnection::factory()->forUser($data->user)->forOrganization($data->organization)->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->putJson(route('api.v1.jira.update-settings', ['organization' => $data->organization->getKey()]), [
            'sync_from_date' => '2026-01-01',
        ]);

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertJsonPath('data.sync_from_date', '2026-01-01');
        $this->assertDatabaseHas('jira_connections', [
            'user_id' => $data->user->getKey(),
            'sync_from_date' => '2026-01-01',
        ]);
    }

    public function test_update_settings_endpoint_clears_the_sync_cutoff(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        JiraConnection::factory()->forUser($data->user)->forOrganization($data->organization)->syncFrom('2026-01-01')->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->putJson(route('api.v1.jira.update-settings', ['organization' => $data->organization->getKey()]), [
            'sync_from_date' => null,
        ]);

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertJsonPath('data.sync_from_date', null);
    }

    public function test_update_settings_endpoint_fails_when_not_connected(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        Passport::actingAs($data->user);

        // Act
        $response = $this->putJson(route('api.v1.jira.update-settings', ['organization' => $data->organization->getKey()]), [
            'sync_from_date' => '2026-01-01',
        ]);

        // Assert
        $this->assertResponseCode($response, 400);
        $response->assertJsonPath('key', 'jira_not_connected');
    }

    public function test_sync_status_endpoint_ignores_entries_before_the_cutoff(): void
    {
        // Arrange
        // What the cutoff is for: history imported from Toggl or Clockify that was already
        // logged to Jira should not show up as work waiting to be sent.
        $data = $this->configuredOrganization();
        JiraConnection::factory()->forUser($data->user)->forOrganization($data->organization)->syncFrom('2026-08-05')->create();
        Passport::actingAs($data->user);
        $imported = TimeEntry::factory()->forUser($data->user)->forOrganization($data->organization)->create([
            'description' => 'PROJ-1 imported from clockify',
            'start' => '2026-08-04T09:00:00',
            'end' => '2026-08-04T10:00:00',
        ]);
        $current = TimeEntry::factory()->forUser($data->user)->forOrganization($data->organization)->create([
            'description' => 'PROJ-1 tracked in solidtime',
            'start' => '2026-08-05T09:00:00',
            'end' => '2026-08-05T10:00:00',
        ]);

        // Act
        $response = $this->getJson(route('api.v1.jira.sync-status', [
            'organization' => $data->organization->getKey(),
            'start' => '2026-08-04',
            'end' => '2026-08-05',
        ]));

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertJsonPath('data.'.$imported->getKey().'.state', 'ignored');
        $response->assertJsonPath('data.'.$imported->getKey().'.reason', 'before_cutoff');
        $response->assertJsonPath('data.'.$current->getKey().'.state', 'pending');
    }

    public function test_destroy_endpoint_removes_the_connection(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        JiraConnection::factory()->forUser($data->user)->forOrganization($data->organization)->create();
        Passport::actingAs($data->user);

        // Act
        $response = $this->deleteJson(route('api.v1.jira.destroy', ['organization' => $data->organization->getKey()]));

        // Assert
        $this->assertResponseCode($response, 204);
        $this->assertDatabaseCount('jira_connections', 0);
    }

    public function test_sync_status_endpoint_returns_a_state_per_time_entry(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        Passport::actingAs($data->user);
        $withKey = TimeEntry::factory()->forUser($data->user)->forOrganization($data->organization)->create([
            'description' => 'PROJ-1 fix login',
            'start' => '2026-08-05T09:00:00',
            'end' => '2026-08-05T10:00:00',
        ]);
        $withoutKey = TimeEntry::factory()->forUser($data->user)->forOrganization($data->organization)->create([
            'description' => 'team standup',
            'start' => '2026-08-05T11:00:00',
            'end' => '2026-08-05T11:15:00',
        ]);

        // Act
        $response = $this->getJson(route('api.v1.jira.sync-status', [
            'organization' => $data->organization->getKey(),
            'start' => '2026-08-05',
            'end' => '2026-08-05',
        ]));

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertJsonPath('data.'.$withKey->getKey().'.state', 'pending');
        $response->assertJsonPath('data.'.$withoutKey->getKey().'.state', 'no_reference');
    }

    public function test_sync_status_endpoint_rejects_a_range_longer_than_the_maximum(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.jira.sync-status', [
            'organization' => $data->organization->getKey(),
            'start' => '2026-01-01',
            'end' => '2026-12-31',
        ]));

        // Assert
        $this->assertResponseCode($response, 422);
    }

    public function test_sync_preview_endpoint_fails_when_not_connected(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.jira.sync-preview', [
            'organization' => $data->organization->getKey(),
            'start' => '2026-08-05',
            'end' => '2026-08-05',
        ]));

        // Assert
        $this->assertResponseCode($response, 400);
        $response->assertJsonPath('key', 'jira_not_connected');
    }

    public function test_sync_preview_endpoint_describes_what_would_happen(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        JiraConnection::factory()->forUser($data->user)->forOrganization($data->organization)->create();
        Passport::actingAs($data->user);
        TimeEntry::factory()->forUser($data->user)->forOrganization($data->organization)->create([
            'description' => 'PROJ-1 fix login',
            'start' => '2026-08-05T09:00:00',
            'end' => '2026-08-05T10:00:00',
        ]);

        // Act
        $response = $this->getJson(route('api.v1.jira.sync-preview', [
            'organization' => $data->organization->getKey(),
            'start' => '2026-08-05',
            'end' => '2026-08-05',
        ]));

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertJsonPath('data.items.0.action', 'create');
        $response->assertJsonPath('data.items.0.issue_key', 'PROJ-1');
        $response->assertJsonPath('data.items.0.duration', 3600);
    }

    public function test_sync_endpoint_queues_a_run_and_returns_its_id(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        JiraConnection::factory()->forUser($data->user)->forOrganization($data->organization)->create();
        Passport::actingAs($data->user);
        TimeEntry::factory()->forUser($data->user)->forOrganization($data->organization)->create([
            'description' => 'PROJ-1 fix login',
            'start' => '2026-08-05T09:00:00',
            'end' => '2026-08-05T10:00:00',
        ]);
        Queue::fake();

        // Act
        $response = $this->postJson(route('api.v1.jira.sync', ['organization' => $data->organization->getKey()]), [
            'start' => '2026-08-05',
            'end' => '2026-08-05',
        ]);

        // Assert
        $this->assertResponseCode($response, 200);
        $response->assertJsonPath('data.status', 'queued');
        $response->assertJsonPath('data.total', 1);
        Queue::assertPushed(SyncJiraWorklogs::class);

        // The returned run is immediately pollable
        $runId = $response->json('data.id');
        $runResponse = $this->getJson(route('api.v1.jira.sync-run', [
            'organization' => $data->organization->getKey(),
            'runId' => $runId,
        ]));
        $this->assertResponseCode($runResponse, 200);
        $runResponse->assertJsonPath('data.id', $runId);
    }

    public function test_sync_run_endpoint_returns_404_for_an_unknown_run(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.jira.sync-run', [
            'organization' => $data->organization->getKey(),
            'runId' => 'does-not-exist',
        ]));

        // Assert
        $this->assertResponseCode($response, 404);
    }

    public function test_sync_run_endpoint_does_not_expose_another_users_run(): void
    {
        // Arrange
        $data = $this->configuredOrganization();
        JiraConnection::factory()->forUser($data->user)->forOrganization($data->organization)->create();
        Passport::actingAs($data->user);
        Queue::fake();
        $runId = $this->postJson(route('api.v1.jira.sync', ['organization' => $data->organization->getKey()]), [
            'start' => '2026-08-05',
            'end' => '2026-08-05',
        ])->json('data.id');

        // The owner of the organization is a different user, with the same permission
        $other = $data->owner;
        $other->timezone = 'UTC';
        $other->save();
        Passport::actingAs($other);

        // Act
        $response = $this->getJson(route('api.v1.jira.sync-run', [
            'organization' => $data->organization->getKey(),
            'runId' => $runId,
        ]));

        // Assert
        $this->assertResponseCode($response, 404);
    }
}
