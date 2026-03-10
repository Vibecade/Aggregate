import { NextRequest, NextResponse } from "next/server";

import { ensureFreshStories, getCacheMeta, refreshStories } from "@/lib/cache";
import { getStoryStats, listStories } from "@/lib/db";
import type { StoryType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseType(value: string | null): StoryType | undefined {
  if (value === "news" || value === "twitter" || value === "farcaster") {
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

    const [stories, stats, meta] = await Promise.all([
      listStories({ limit, type }),
      getStoryStats(),
      getCacheMeta(),
    ]);

    return NextResponse.json({
      stories,
      stats,
      meta,
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
