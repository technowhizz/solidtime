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
        Schema::create('google_calendar_connections', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id')->unique();
            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->restrictOnDelete()
                ->cascadeOnUpdate();
            // The Google account identifier ("sub"). Nullable because it is only present if
            // Google returns it for the granted scopes, and a missing one must not break the
            // connect flow - it is only used to show that a different account was linked.
            $table->string('google_user_id')->nullable();
            $table->string('email')->nullable();
            // Encrypted at rest, so the ciphertext needs more room than a token itself
            $table->text('access_token');
            $table->text('refresh_token')->nullable();
            $table->dateTime('expires_at')->nullable();
            $table->jsonb('scopes');
            $table->boolean('requires_reauthentication')->default(false);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('google_calendar_connections');
    }
};
