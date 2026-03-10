import { NextResponse } from "next/server";

import { getCacheMeta, refreshStories } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await refreshStories();

    return NextResponse.json({
      refreshed: true,
      result,
      meta: await getCacheMeta(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";

    return NextResponse.json(
      {
        refreshed: false,
        error: "Refresh failed",
        message,
      },
      { status: 503 },
    );
  }
}
