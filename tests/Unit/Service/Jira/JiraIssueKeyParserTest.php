<?php

declare(strict_types=1);

namespace Tests\Unit\Service\Jira;

use App\Service\Jira\JiraIssueKeyParser;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

#[CoversClass(JiraIssueKeyParser::class)]
class JiraIssueKeyParserTest extends TestCase
{
    private function parser(): JiraIssueKeyParser
    {
        return new JiraIssueKeyParser;
    }

    public function test_parse_finds_a_key_at_the_start_of_the_description(): void
    {
        // Act
        $reference = $this->parser()->parse('PROJ-123 fixed the login redirect');

        // Assert
        $this->assertNotNull($reference);
        $this->assertSame('PROJ-123', $reference->issueKey);
        $this->assertSame('fixed the login redirect', $reference->comment);
    }

    public function test_parse_finds_a_key_in_the_middle_of_the_description(): void
    {
        // Arrange
        // The original script only looked at the first word, so this entry was skipped

        // Act
        $reference = $this->parser()->parse('looked into PROJ-123 with Sam');

        // Assert
        $this->assertNotNull($reference);
        $this->assertSame('PROJ-123', $reference->issueKey);
        $this->assertSame('looked into with Sam', $reference->comment);
    }

    public function test_parse_returns_the_first_key_when_several_are_mentioned(): void
    {
        // Act
        $reference = $this->parser()->parse('PROJ-1 blocked by PROJ-2');

        // Assert
        $this->assertNotNull($reference);
        $this->assertSame('PROJ-1', $reference->issueKey);
        $this->assertSame('blocked by PROJ-2', $reference->comment);
    }

    #[DataProvider('provideSeparators')]
    public function test_parse_strips_a_separator_left_behind_by_the_key(string $description): void
    {
        // Act
        $reference = $this->parser()->parse($description);

        // Assert
        $this->assertNotNull($reference);
        $this->assertSame('fixed the login redirect', $reference->comment);
    }

    /**
     * @return array<string, array{string}>
     */
    public static function provideSeparators(): array
    {
        return [
            'colon' => ['PROJ-123: fixed the login redirect'],
            'dash' => ['PROJ-123 - fixed the login redirect'],
            'en dash' => ['PROJ-123 – fixed the login redirect'],
            'plain space' => ['PROJ-123 fixed the login redirect'],
        ];
    }

    public function test_parse_returns_no_comment_when_the_description_is_only_a_key(): void
    {
        // Arrange
        // Jira rejects an empty comment, and the worklog is already attached to the issue

        // Act
        $reference = $this->parser()->parse('PROJ-123');

        // Assert
        $this->assertNotNull($reference);
        $this->assertNull($reference->comment);
    }

    public function test_parse_returns_null_for_a_description_without_a_key(): void
    {
        // Act & Assert
        $this->assertNull($this->parser()->parse('team standup'));
        $this->assertNull($this->parser()->parse(''));
        $this->assertNull($this->parser()->parse(null));
    }

    public function test_parse_does_not_match_a_lowercase_or_single_letter_key(): void
    {
        // Act & Assert
        $this->assertNull($this->parser()->parse('proj-123 fixed the login redirect'));
        $this->assertNull($this->parser()->parse('X-1 fixed the login redirect'));
    }

    public function test_parse_does_not_treat_a_longer_key_as_a_shorter_one(): void
    {
        // Act
        $reference = $this->parser()->parse('MYPROJ-12 refactor');

        // Assert
        $this->assertNotNull($reference);
        $this->assertSame('MYPROJ-12', $reference->issueKey);
    }

    #[DataProvider('provideFalsePositives')]
    public function test_parse_matches_things_that_merely_look_like_keys_without_an_allow_list(string $description, string $expectedKey): void
    {
        // Arrange
        // Documents why the project key allow list exists: the shape alone is ambiguous

        // Act
        $reference = $this->parser()->parse($description);

        // Assert
        $this->assertNotNull($reference);
        $this->assertSame($expectedKey, $reference->issueKey);
    }

    /**
     * @return array<string, array{string, string}>
     */
    public static function provideFalsePositives(): array
    {
        return [
            'encoding' => ['fixed UTF-8 handling in the importer', 'UTF-8'],
            'disease' => ['COVID-19 policy update', 'COVID-19'],
            'standard' => ['switched to ISO-8601 timestamps', 'ISO-8601'],
        ];
    }

    #[DataProvider('provideFalsePositives')]
    public function test_parse_rejects_look_alikes_when_an_allow_list_is_configured(string $description, string $lookAlikeKey): void
    {
        // Arrange
        $this->assertNotContains($lookAlikeKey, ['PROJ', 'OPS']);

        // Act
        $reference = $this->parser()->parse($description, ['PROJ', 'OPS']);

        // Assert
        $this->assertNull($reference);
    }

    public function test_parse_skips_to_the_first_allowed_key(): void
    {
        // Act
        $reference = $this->parser()->parse('fixed UTF-8 handling for PROJ-9', ['PROJ']);

        // Assert
        $this->assertNotNull($reference);
        $this->assertSame('PROJ-9', $reference->issueKey);
        $this->assertSame('fixed UTF-8 handling for', $reference->comment);
    }
}
