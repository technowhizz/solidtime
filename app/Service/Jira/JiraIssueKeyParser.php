<?php

declare(strict_types=1);

namespace App\Service\Jira;

class JiraIssueKeyParser
{
    /**
     * Jira project keys start with a letter and are at least two characters, then a hyphen and
     * the issue number. Deliberately anchored on word boundaries so "see PROJ-12." matches but
     * "MYPROJ-12" is not mistaken for "PROJ-12".
     */
    private const string ISSUE_KEY_PATTERN = '/\b([A-Z][A-Z0-9]+)-(\d+)\b/';

    /**
     * Finds the issue the description refers to, and what is left of the description once the
     * key is removed.
     *
     * The first match wins, so "PROJ-1 blocked by PROJ-2" logs against PROJ-1. Without an
     * allow list this also matches things that merely look like keys - UTF-8, COVID-19,
     * ISO-8601 - which is why an organization can restrict detection to its own project keys.
     *
     * @param  list<string>  $allowedProjectKeys  Empty means no restriction
     */
    public function parse(?string $description, array $allowedProjectKeys = []): ?JiraIssueReference
    {
        $description = trim((string) $description);
        if ($description === '') {
            return null;
        }

        if (preg_match_all(self::ISSUE_KEY_PATTERN, $description, $matches, PREG_SET_ORDER) < 1) {
            return null;
        }

        /** @var array<int, array<int, string>> $matches */
        foreach ($matches as $match) {
            if ($allowedProjectKeys !== [] && ! in_array($match[1], $allowedProjectKeys, true)) {
                continue;
            }

            return new JiraIssueReference($match[0], $this->commentWithout($description, $match[0]));
        }

        return null;
    }

    /**
     * Removes the first occurrence of the key, then tidies what that leaves behind: a stray
     * leading separator from "PROJ-123: fixed login" or "PROJ-123 - fixed login", and any run
     * of whitespace the removal opened up in the middle.
     */
    private function commentWithout(string $description, string $issueKey): ?string
    {
        $position = strpos($description, $issueKey);
        if ($position === false) {
            return $description;
        }

        $comment = substr($description, 0, $position).substr($description, $position + strlen($issueKey));
        $comment = (string) preg_replace('/\s+/', ' ', $comment);
        $comment = trim($comment);
        $comment = (string) preg_replace('/^[\s:;,\-\x{2013}\x{2014}]+/u', '', $comment);
        $comment = trim($comment);

        return $comment === '' ? null : $comment;
    }
}
