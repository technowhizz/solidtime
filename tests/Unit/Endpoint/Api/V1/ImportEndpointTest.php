<?php

declare(strict_types=1);

namespace Tests\Unit\Endpoint\Api\V1;

use App\Http\Controllers\Api\V1\ImportController;
use App\Models\Member;
use App\Models\Organization;
use App\Service\Import\Importers\ImportException;
use App\Service\Import\Importers\ReportDto;
use App\Service\Import\ImportService;
use Laravel\Passport\Passport;
use Mockery\MockInterface;
use PHPUnit\Framework\Attributes\UsesClass;

#[UsesClass(ImportController::class)]
class ImportEndpointTest extends ApiEndpointTestAbstract
{
    public function test_index_fails_if_user_does_not_have_permission(): void
    {
        // Arrange
        $data = $this->createUserWithPermission();

        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.import.index', ['organization' => $data->organization->getKey()]));

        // Assert
        $response->assertForbidden();
    }

    public function test_index_returns_importers_if_user_has_permission(): void
    {
        // Arrange
        $data = $this->createUserWithPermission([
            'import',
        ]);
        Passport::actingAs($data->user);

        // Act
        $response = $this->getJson(route('api.v1.import.index', ['organization' => $data->organization->getKey()]));

        // Assert
        $response->assertOk();
        $response->assertJsonStructure([
            'data' => [
                [
                    'key',
                    'name',
                    'description',
                    'supports_member_assignment',
                ],
            ],
        ]);
        $toggleTimeEntries = collect($response->json('data'))->where('key', 'toggl_time_entries')->first();
        $this->assertSame('toggl_time_entries', $toggleTimeEntries['key']);
        $this->assertSame('Toggl Time Entries', $toggleTimeEntries['name']);
        $this->assertSame(__('importer.toggl_time_entries.description'), $toggleTimeEntries['description']);
        $this->assertTrue($toggleTimeEntries['supports_member_assignment']);
        $solidtimeImporter = collect($response->json('data'))->where('key', 'solidtime')->first();
        $this->assertFalse($solidtimeImporter['supports_member_assignment']);
    }

    public function test_import_fails_if_user_does_not_have_permission(): void
    {
        // Arrange
        $data = $this->createUserWithPermission();

        Passport::actingAs($data->user);

        // Act
        $response = $this->postJson(route('api.v1.import.import', ['organization' => $data->organization->getKey()]), [
            'type' => 'toggl_time_entries',
            'data' => base64_encode('some data'),
            'options' => [],
        ]);

        // Assert
        $response->assertForbidden();
    }

    public function test_import_fails_if_data_can_not_be_base64_decoded(): void
    {
        // Arrange
        $user = $this->createUserWithPermission([
            'import',
        ]);
        Passport::actingAs($user->user);

        // Act
        $response = $this->postJson(route('api.v1.import.import', ['organization' => $user->organization->getKey()]), [
            'type' => 'toggl_time_entries',
            'data' => 'some invalid data ...',
        ]);

        // Assert
        $response->assertStatus(400);
        $response->assertExactJson([
            'message' => 'Invalid base64 encoded data',
        ]);
    }

    public function test_import_return_error_message_if_import_fails(): void
    {
        // Arrange
        $user = $this->createUserWithPermission([
            'import',
        ]);
        $this->mock(ImportService::class, function (MockInterface $mock) use (&$user): void {
            $mock->shouldReceive('import')
                ->withArgs(function (Organization $organization, string $importerType, string $data) use (&$user): bool {
                    return $organization->is($user->organization) && $importerType === 'toggl_time_entries' && $data === 'some data';
                })
                ->andThrow(new ImportException('This is a test error!'))
                ->once();
        });
        Passport::actingAs($user->user);

        // Act
        $response = $this->postJson(route('api.v1.import.import', ['organization' => $user->organization->getKey()]), [
            'type' => 'toggl_time_entries',
            'data' => base64_encode('some data'),
        ]);

        // Assert
        $response->assertStatus(400);
        $response->assertExactJson([
            'message' => 'This is a test error!',
        ]);
    }

    public function test_import_fails_if_member_id_belongs_to_a_different_organization(): void
    {
        // Arrange
        $user = $this->createUserWithPermission([
            'import',
        ]);
        $otherOrganization = $this->createUserWithPermission();
        Passport::actingAs($user->user);

        // Act
        $response = $this->postJson(route('api.v1.import.import', ['organization' => $user->organization->getKey()]), [
            'type' => 'toggl_time_entries',
            'data' => base64_encode('some data'),
            'member_id' => $otherOrganization->member->getKey(),
        ]);

        // Assert
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['member_id']);
    }

    public function test_import_passes_the_target_member_to_the_import_service(): void
    {
        // Arrange
        $user = $this->createUserWithPermission([
            'import',
        ]);
        $this->mock(ImportService::class, function (MockInterface $mock) use (&$user): void {
            $mock->shouldReceive('import')
                ->withArgs(function (Organization $organization, string $importerType, string $data, string $timezone, ?Member $targetMember) use (&$user): bool {
                    return $organization->is($user->organization)
                        && $importerType === 'toggl_time_entries'
                        && $data === 'some data'
                        && $targetMember !== null
                        && $targetMember->is($user->member);
                })
                ->andReturn(new ReportDto(
                    clientsCreated: 0,
                    projectsCreated: 0,
                    tasksCreated: 0,
                    timeEntriesCreated: 1,
                    tagsCreated: 0,
                    usersCreated: 0,
                ))
                ->once();
        });
        Passport::actingAs($user->user);

        // Act
        $response = $this->postJson(route('api.v1.import.import', ['organization' => $user->organization->getKey()]), [
            'type' => 'toggl_time_entries',
            'data' => base64_encode('some data'),
            'member_id' => $user->member->getKey(),
        ]);

        // Assert
        $response->assertStatus(200);
    }

    public function test_import_calls_import_service_if_user_has_permission(): void
    {
        // Arrange
        $user = $this->createUserWithPermission([
            'import',
        ]);
        $this->mock(ImportService::class, function (MockInterface $mock) use (&$user): void {
            $mock->shouldReceive('import')
                ->withArgs(function (Organization $organization, string $importerType, string $data) use (&$user): bool {
                    return $organization->is($user->organization) && $importerType === 'toggl_time_entries' && $data === 'some data';
                })
                ->andReturn(new ReportDto(
                    clientsCreated: 1,
                    projectsCreated: 2,
                    tasksCreated: 3,
                    timeEntriesCreated: 4,
                    tagsCreated: 5,
                    usersCreated: 6,
                ))
                ->once();
        });
        Passport::actingAs($user->user);

        // Act
        $response = $this->postJson(route('api.v1.import.import', ['organization' => $user->organization->getKey()]), [
            'type' => 'toggl_time_entries',
            'data' => base64_encode('some data'),
        ]);

        // Assert
        $response->assertStatus(200);
        $response->assertExactJson([
            'report' => [
                'clients' => [
                    'created' => 1,
                ],
                'projects' => [
                    'created' => 2,
                ],
                'tasks' => [
                    'created' => 3,
                ],
                'time_entries' => [
                    'created' => 4,
                ],
                'tags' => [
                    'created' => 5,
                ],
                'users' => [
                    'created' => 6,
                ],
            ],
        ]);
    }
}
