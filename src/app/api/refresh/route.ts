import { NextResponse } from "next/server";

import { getCacheMeta, refreshStories } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const result = await refreshStories();

  return NextResponse.json({
    refreshed: true,
    result,
    meta: getCacheMeta(),
  });
}
