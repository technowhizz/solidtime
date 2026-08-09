<?php

declare(strict_types=1);

namespace App\Http\Requests\V1\Jira;

use App\Http\Requests\V1\BaseFormRequest;
use Closure;
use Illuminate\Contracts\Validation\Rule as RuleContract;
use Illuminate\Contracts\Validation\ValidationRule;

class JiraConnectionUpdateRequest extends BaseFormRequest
{
    /**
     * @return array<string, array<string|ValidationRule|RuleContract|Closure>>
     */
    public function rules(): array
    {
        return [
            // The Atlassian account email the API token belongs to
            'email' => [
                'required',
                'string',
                'email',
                'max:255',
            ],
            // An Atlassian API token, created at id.atlassian.com. Never sent back to the client.
            'api_token' => [
                'required',
                'string',
                'max:1000',
            ],
        ];
    }

    public function getEmail(): string
    {
        return (string) $this->validated('email');
    }

    public function getApiToken(): string
    {
        return (string) $this->validated('api_token');
    }
}
