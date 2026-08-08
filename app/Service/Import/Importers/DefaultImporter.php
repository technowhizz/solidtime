<?php

declare(strict_types=1);

namespace App\Service\Import\Importers;

use App\Enums\Role;
use App\Models\Client;
use App\Models\Member;
use App\Models\Organization;
use App\Models\OrganizationInvitation;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\Tag;
use App\Models\Task;
use App\Models\User;
use App\Service\BillableRateService;
use App\Service\ColorService;
use App\Service\Import\ImportDatabaseHelper;
use App\Service\TimezoneService;
use Illuminate\Database\Eloquent\Builder;

abstract class DefaultImporter implements ImporterContract
{
    protected Organization $organization;

    /**
     * When set, every imported time entry is assigned to this member and no placeholder
     * user/member is created from the import file.
     */
    protected ?Member $targetMember = null;

    /**
     * @var ImportDatabaseHelper<User>
     */
    protected ImportDatabaseHelper $userImportHelper;

    /**
     * @var ImportDatabaseHelper<Member>
     */
    protected ImportDatabaseHelper $memberImportHelper;

    /**
     * @var ImportDatabaseHelper<Project>
     */
    protected ImportDatabaseHelper $projectImportHelper;

    /**
     * @var ImportDatabaseHelper<Tag>
     */
    protected ImportDatabaseHelper $tagImportHelper;

    /**
     * @var ImportDatabaseHelper<Client>
     */
    protected ImportDatabaseHelper $clientImportHelper;

    /**
     * @var ImportDatabaseHelper<Task>
     */
    protected ImportDatabaseHelper $taskImportHelper;

    protected int $timeEntriesCreated;

    protected ColorService $colorService;

    protected TimezoneService $timezoneService;

    /**
     * @var ImportDatabaseHelper<ProjectMember>
     */
    protected ImportDatabaseHelper $projectMemberImportHelper;

    /**
     * @var ImportDatabaseHelper<OrganizationInvitation>
     */
    protected ImportDatabaseHelper $organizationInvitationsImportHelper;

    protected BillableRateService $billableRateService;

    public function init(Organization $organization, ?Member $targetMember = null): void
    {
        $this->organization = $organization;
        $this->targetMember = $this->supportsTargetMember() ? $targetMember : null;
        $this->userImportHelper = new ImportDatabaseHelper(User::class, ['email'], true, function (Builder $builder) {
            /** @var Builder<User> $builder */
            return $builder->belongsToOrganization($this->organization);
        }, null, validate: [
            'name' => [
                'required',
                'max:255',
            ],
            'timezone' => [
                'required',
                'timezone:all',
            ],
        ]);
        $this->memberImportHelper = new ImportDatabaseHelper(Member::class, ['user_id', 'organization_id'], true, function (Builder $builder) {
            /** @var Builder<Member> $builder */
            return $builder->whereBelongsTo($this->organization, 'organization');
        }, null, validate: [
            'role' => [
                'required',
                'string',
                'in:placeholder',
            ],
        ]);
        $this->projectImportHelper = new ImportDatabaseHelper(Project::class, ['name', 'client_id', 'organization_id'], true, function (Builder $builder) {
            /** @var Builder<Project> $builder */
            return $builder->where('organization_id', $this->organization->id);
        }, validate: [
            'name' => [
                'required',
                'max:255',
            ],
            'is_billable' => [
                'required',
                'boolean',
            ],
            'billable_rate' => [
                'nullable',
                'integer',
                'max:2147483647',
            ],
            'client_id' => [
                'nullable',
                'string',
                'uuid',
            ],
        ], beforeSave: function (Project $project): void {
            if ($project->billable_rate === 0) {
                $project->billable_rate = null;
            }
        });
        $this->projectMemberImportHelper = new ImportDatabaseHelper(ProjectMember::class, ['project_id', 'member_id'], true, function (Builder $builder): Builder {
            /** @var Builder<ProjectMember> $builder */
            return $builder->whereBelongsToOrganization($this->organization);
        }, validate: [
            'billable_rate' => [
                'nullable',
                'integer',
                'max:2147483647',
            ],
        ], beforeSave: function (ProjectMember $projectMember): void {
            if ($projectMember->billable_rate === 0) {
                $projectMember->billable_rate = null;
            }
        });
        $this->tagImportHelper = new ImportDatabaseHelper(Tag::class, ['name', 'organization_id'], true, function (Builder $builder): Builder {
            /** @var Builder<Tag> $builder */
            return $builder->where('organization_id', $this->organization->id);
        }, validate: [
            'name' => [
                'required',
                'max:255',
            ],
        ]);
        $this->clientImportHelper = new ImportDatabaseHelper(Client::class, ['name', 'organization_id'], true, function (Builder $builder): Builder {
            /** @var Builder<Client> $builder */
            return $builder->where('organization_id', $this->organization->id);
        }, validate: [
            'name' => [
                'required',
                'max:255',
            ],
        ]);
        $this->taskImportHelper = new ImportDatabaseHelper(Task::class, ['name', 'project_id', 'organization_id'], true, function (Builder $builder): Builder {
            /** @var Builder<Task> $builder */
            return $builder->where('organization_id', $this->organization->id);
        }, validate: [
            'name' => [
                'required',
                'max:500',
            ],
        ]);
        $this->organizationInvitationsImportHelper = new ImportDatabaseHelper(OrganizationInvitation::class, ['email', 'organization_id'], true, function (Builder $builder) {
            /** @var Builder<OrganizationInvitation> $builder */
            return $builder->where('organization_id', $this->organization->id);
        }, validate: [
            'email' => [
                'required',
                'email:rfc,strict',
                'max:255',
            ],
        ]);
        $this->timeEntriesCreated = 0;
        $this->colorService = app(ColorService::class);
        $this->timezoneService = app(TimezoneService::class);
        $this->billableRateService = app(BillableRateService::class);
    }

    #[\Override]
    public function supportsTargetMember(): bool
    {
        return false;
    }

    /**
     * Resolve the member that an imported time entry belongs to.
     *
     * Without a target member the owner is derived from the import file, creating a placeholder
     * user and member for anyone who is not part of the organization yet. That is right for a
     * team export, but it hides the entries from the calendar and the time tab when someone
     * imports their own export under a different email, because those views always filter by
     * the current membership. A target member skips the placeholders entirely.
     *
     * @return array{0: string, 1: string, 2: Member|null} user id, member id and the member itself
     *
     * @throws ImportException
     */
    protected function resolveTimeEntryMember(string $email, string $name): array
    {
        if ($this->targetMember !== null) {
            return [$this->targetMember->user_id, $this->targetMember->getKey(), $this->targetMember];
        }

        $userId = $this->userImportHelper->getKey([
            'email' => $email,
        ], [
            'name' => $name,
            'timezone' => 'UTC',
            'is_placeholder' => true,
        ]);
        $memberId = $this->memberImportHelper->getKey([
            'user_id' => $userId,
            'organization_id' => $this->organization->getKey(),
        ], [
            'role' => Role::Placeholder->value,
        ]);

        return [$userId, $memberId, $this->memberImportHelper->getModelById($memberId)];
    }

    #[\Override]
    public function getReport(): ReportDto
    {
        return new ReportDto(
            clientsCreated: $this->clientImportHelper->getCreatedCount(),
            projectsCreated: $this->projectImportHelper->getCreatedCount(),
            tasksCreated: $this->taskImportHelper->getCreatedCount(),
            timeEntriesCreated: $this->timeEntriesCreated,
            tagsCreated: $this->tagImportHelper->getCreatedCount(),
            usersCreated: $this->userImportHelper->getCreatedCount(),
        );
    }
}
