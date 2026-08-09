<?php

declare(strict_types=1);

namespace App\Exceptions\Api;

class JiraAuthenticationFailedApiException extends ApiException
{
    public const string KEY = 'jira_authentication_failed';
}
