import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

async function ensureProductsTable(sql: ReturnType<typeof getDb>) {
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id INTEGER,
      name VARCHAR(500) NOT NULL,
      sku VARCHAR(100),
      price DECIMAL(12,2) DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'USD',
      stock INTEGER DEFAULT 0,
      category VARCHAR(200),
      description TEXT,
      image_url TEXT,
      channels JSONB DEFAULT '[]',
      status VARCHAR(20) DEFAULT 'draft',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  await ensureProductsTable(sql);
  const email = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) return NextResponse.json({ products: [] });
  const userId = users[0].id as number;

  const search = req.nextUrl.searchParams.get("search") || "";
  const like = search ? `%${search}%` : "";

  const products = search
    ? await sql`SELECT * FROM products WHERE user_id = ${userId} AND (name ILIKE ${like} OR sku ILIKE ${like}) ORDER BY created_at DESC`
    : await sql`SELECT * FROM products WHERE user_id = ${userId} ORDER BY created_at DESC`;

  return NextResponse.json({ products });
}

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  await ensureProductsTable(sql);
  const email = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const body = await req.json();
  const { action } = body;

  if (action === "create") {
    const result = await sql`
      INSERT INTO products (user_id, name, sku, price, currency, stock, category, description, image_url, status)
      VALUES (${userId}, ${body.name}, ${body.sku || null}, ${body.price || 0}, ${body.currency || 'USD'}, ${body.stock || 0}, ${body.category || null}, ${body.description || null}, ${body.image_url || null}, ${body.status || 'draft'})
      RETURNING *
    `;
    return NextResponse.json({ product: result[0] });
  }

  if (action === "update") {
    const result = await sql`
      UPDATE products SET
        name = ${body.name},
        sku = ${body.sku || null},
        price = ${body.price || 0},
        currency = ${body.currency || 'USD'},
        stock = ${body.stock || 0},
        category = ${body.category || null},
        description = ${body.description || null},
        image_url = ${body.image_url || null},
        status = ${body.status || 'draft'},
        updated_at = NOW()
      WHERE id = ${body.id} AND user_id = ${userId}
      RETURNING *
    `;
    return NextResponse.json({ product: result[0] });
  }

  if (action === "delete") {
    await sql`DELETE FROM products WHERE id = ${body.id} AND user_id = ${userId}`;
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
