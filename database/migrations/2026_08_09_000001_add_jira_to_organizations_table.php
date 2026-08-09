<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table): void {
            // Base URL of the organization's Jira Cloud site, ex. https://acme.atlassian.net.
            // Set by an admin, so every member logs against the same site while still using
            // their own credentials.
            $table->string('jira_site_url')->nullable();
            // Optional comma separated allow list of project keys, ex. "PROJ,OPS". Without it
            // anything shaped like an issue key is detected, which also matches things like
            // UTF-8 and COVID-19.
            $table->string('jira_project_keys')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('organizations', function (Blueprint $table): void {
            $table->dropColumn(['jira_site_url', 'jira_project_keys']);
        });
    }
};
