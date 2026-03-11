import { NextRequest, NextResponse } from "next/server";

import {
  ensureFreshStories,
  getCacheMeta,
  getLastRefreshReport,
  refreshStories,
} from "@/lib/cache";
import { getStoryStats, listStories } from "@/lib/db";
import { isStoryType, type StoryType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseType(value: string | null): StoryType | undefined {
  if (value && isStoryType(value)) {
    return value;
  }

  return undefined;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shouldForceRefresh = searchParams.get("refresh") === "true";
    const type = parseType(searchParams.get("type"));
    const limit = parseLimit(searchParams.get("limit"));

    if (shouldForceRefresh) {
      await refreshStories();
    } else {
      await ensureFreshStories();
    }

    const [stories, stats, meta, report] = await Promise.all([
      listStories({ limit, type }),
      getStoryStats(),
      getCacheMeta(),
      getLastRefreshReport(),
    ]);

    return NextResponse.json({
      stories,
      stats,
      meta,
      health: report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Feed unavailable";

    return NextResponse.json(
      {
        error: "Feed unavailable",
        message,
      },
      { status: 503 },
    );
  }
}
