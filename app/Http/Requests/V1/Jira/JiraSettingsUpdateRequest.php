<?php

declare(strict_types=1);

namespace App\Http\Requests\V1\Jira;

use App\Http\Requests\V1\BaseFormRequest;
use Closure;
use Illuminate\Contracts\Validation\Rule as RuleContract;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Carbon;

class JiraSettingsUpdateRequest extends BaseFormRequest
{
    /**
     * @return array<string, array<string|ValidationRule|RuleContract|Closure>>
     */
    public function rules(): array
    {
        return [
            // Local date (example: 2026-01-01). Work before it is treated as already logged in
            // Jira, which is what you want after importing history from another tracker. Null
            // removes the cutoff.
            'sync_from_date' => [
                'present',
                'nullable',
                'string',
                'date_format:Y-m-d',
            ],
        ];
    }

    /**
     * A date rather than a string, since that is what the model casts the column to.
     */
    public function getSyncFromDate(): ?Carbon
    {
        $value = $this->validated('sync_from_date');
        if (! is_string($value) || $value === '') {
            return null;
        }

        return Carbon::createFromFormat('Y-m-d', $value)->startOfDay();
    }
}
