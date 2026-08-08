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
        Schema::table('users', function (Blueprint $table): void {
            // Width matches projects.color, so the two are comparable and both have room for
            // the optional alpha channel. The default is the grey the calendar hardcoded
            // before this became a setting, and it backfills every existing row here.
            $table->string('no_project_color', 16)->default('#6b7280')->after('calendar_week_days');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('no_project_color');
        });
    }
};
