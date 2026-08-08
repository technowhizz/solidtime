<?php

declare(strict_types=1);

namespace App\Http\Requests\V1\Import;

use App\Http\Requests\V1\BaseFormRequest;
use App\Models\Member;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Database\Eloquent\Builder;
use Korridor\LaravelModelValidationRules\Rules\ExistsEloquent;

class ImportRequest extends BaseFormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, array<string|ValidationRule>>
     */
    public function rules(): array
    {
        return [
            'type' => [
                'required',
                'string',
            ],
            'data' => [
                'required',
                'string',
            ],
            // Assign all imported time entries to this member instead of taking the owner from the import file
            'member_id' => [
                'nullable',
                'string',
                ExistsEloquent::make(Member::class, null, function (Builder $builder): Builder {
                    /** @var Builder<Member> $builder */
                    return $builder->whereBelongsTo($this->organization, 'organization');
                })->uuid(),
            ],
        ];
    }

    public function getMemberId(): ?string
    {
        $memberId = $this->input('member_id');

        return is_string($memberId) && $memberId !== '' ? $memberId : null;
    }
}
