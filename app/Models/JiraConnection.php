<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\HasUuids;
use Database\Factories\JiraConnectionFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $user_id
 * @property string $organization_id
 * @property string $email
 * @property string|null $account_id
 * @property string|null $display_name
 * @property string $api_token
 * @property bool $requires_reauthentication
 * @property Carbon|null $sync_from_date
 * @property Carbon|null $last_verified_at
 * @property-read User $user
 * @property-read Organization $organization
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 *
 * @method static JiraConnectionFactory factory()
 */
class JiraConnection extends Model
{
    /** @use HasFactory<JiraConnectionFactory> */
    use HasFactory;

    use HasUuids;

    /**
     * Note: deliberately not auditable - audit rows would contain copies of the API token.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'api_token' => 'encrypted',
        'requires_reauthentication' => 'bool',
        'sync_from_date' => 'date',
        'last_verified_at' => 'datetime',
    ];

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /**
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organization_id');
    }
}
