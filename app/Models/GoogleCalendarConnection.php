<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\HasUuids;
use Database\Factories\GoogleCalendarConnectionFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $user_id
 * @property string|null $google_user_id
 * @property string|null $email
 * @property string $access_token
 * @property string|null $refresh_token
 * @property Carbon|null $expires_at
 * @property array<int, string> $scopes
 * @property bool $requires_reauthentication
 * @property-read User $user
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 *
 * @method static GoogleCalendarConnectionFactory factory()
 */
class GoogleCalendarConnection extends Model
{
    /** @use HasFactory<GoogleCalendarConnectionFactory> */
    use HasFactory;

    use HasUuids;

    /**
     * Note: deliberately not auditable - audit rows would contain copies of the OAuth tokens.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'access_token' => 'encrypted',
        'refresh_token' => 'encrypted',
        'expires_at' => 'datetime',
        'scopes' => 'array',
        'requires_reauthentication' => 'bool',
    ];

    /**
     * Whether the stored access token is expired, or close enough to expiry that it should
     * be refreshed before it is used for a request.
     */
    public function needsTokenRefresh(int $leewaySeconds = 60): bool
    {
        if ($this->expires_at === null) {
            return true;
        }

        return $this->expires_at->isBefore(Carbon::now()->addSeconds($leewaySeconds));
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
