<?php

declare(strict_types=1);

namespace App\Service\Import\Importers;

use App\Models\Member;
use App\Models\Organization;

interface ImporterContract
{
    /**
     * @param  Member|null  $targetMember  Assign every imported time entry to this member instead of
     *                                     deriving the owner from the import file. Ignored by importers
     *                                     that do not support it, see supportsTargetMember().
     */
    public function init(Organization $organization, ?Member $targetMember = null): void;

    public function importData(string $data, string $timezone): void;

    /**
     * Whether this importer can assign all imported time entries to one given member.
     */
    public function supportsTargetMember(): bool;

    public function getReport(): ReportDto;

    public function getName(): string;

    public function getDescription(): string;
}
