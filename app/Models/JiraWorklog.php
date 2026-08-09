<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\HasUuids;
use Database\Factories\JiraWorklogFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A worklog in Jira that solidtime created and therefore owns. Worklogs logged by hand in Jira
 * have no row here and are never touched.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $user_id
 * @property string $issue_key
 * @property Carbon $work_date
 * @property string|null $comment
 * @property string $group_hash
 * @property string $jira_worklog_id
 * @property int $duration_seconds
 * @property Carbon $started_at
 * @property Carbon $synced_at
 * @property-read Organization $organization
 * @property-read User $user
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 *
 * @method static JiraWorklogFactory factory()
 */
class JiraWorklog extends Model
{
    /** @use HasFactory<JiraWorklogFactory> */
    use HasFactory;

    use HasUuids;

    /**
     * @var array<string, string>
     */
    protected $casts = [
        'work_date' => 'date',
        'duration_seconds' => 'int',
        'started_at' => 'datetime',
        'synced_at' => 'datetime',
    ];

    /**
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organization_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
