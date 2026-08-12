import { NextResponse } from "next/server";
import { createJob } from "@/jobs/store";

export async function POST() {
  const job = createJob();
  return NextResponse.json({ job });
}
