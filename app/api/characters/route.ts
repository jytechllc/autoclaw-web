import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { listCharacters } from "@/app/api/chat/characters";

export const dynamic = "force-dynamic";

// Returns the available character personas for the chat picker. The list is a
// static code registry (app/api/chat/characters.ts), so this just gates on auth
// and returns the public fields (no system prompts).
export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ characters: listCharacters() });
}
