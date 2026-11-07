import { NextRequest, NextResponse } from "next/server";
import { handlers } from "@/auth";

export async function GET(req: NextRequest) {
  try {
    return await handlers.GET(req);
  } catch (error) {
    console.error("[Auth API GET Error]:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error in Auth API",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handlers.POST(req);
  } catch (error) {
    console.error("[Auth API POST Error]:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error in Auth API",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
