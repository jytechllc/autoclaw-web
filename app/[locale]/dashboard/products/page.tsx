"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import type { Locale } from "@/lib/i18n";

interface Product {
  id: number;
  name: string;
  sku: string;
  price: number;
  currency: string;
  stock: number;
  category: string;
  description: string;
  image_url: string | null;
  channels: string[];
  status: "active" | "draft" | "archived";
  created_at: string;
}

export default function ProductsPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const isZh = locale === "zh" || locale === "zh-TW";
  const { user } = useUser();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formSku, setFormSku] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formCurrency, setFormCurrency] = useState("USD");
  const [formStock, setFormStock] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formImage, setFormImage] = useState("");
  const [formStatus, setFormStatus] = useState<"active" | "draft">("draft");

  const t = {
    title: isZh ? "产品管理" : "Product Management",
    subtitle: isZh ? "管理产品目录，同步到各销售渠道" : "Manage your product catalog, sync to sales channels",
    addProduct: isZh ? "添加产品" : "Add Product",
    editProduct: isZh ? "编辑产品" : "Edit Product",
    name: isZh ? "产品名称" : "Product Name",
    sku: "SKU",
    price: isZh ? "价格" : "Price",
    stock: isZh ? "库存" : "Stock",
    category: isZh ? "分类" : "Category",
    description: isZh ? "描述" : "Description",
    imageUrl: isZh ? "图片链接" : "Image URL",
    status: isZh ? "状态" : "Status",
    active: isZh ? "上架" : "Active",
    draft: isZh ? "草稿" : "Draft",
    archived: isZh ? "已下架" : "Archived",
    save: isZh ? "保存" : "Save",
    cancel: isZh ? "取消" : "Cancel",
    delete: isZh ? "删除" : "Delete",
    search: isZh ? "搜索产品..." : "Search products...",
    noProducts: isZh ? "暂无产品。点击「添加产品」开始。" : "No products yet. Click \"Add Product\" to get started.",
    loading: isZh ? "加载中..." : "Loading...",
    totalProducts: isZh ? "总产品数" : "Total Products",
    activeProducts: isZh ? "上架中" : "Active",
    totalStock: isZh ? "总库存" : "Total Stock",
    channels: isZh ? "销售渠道" : "Channels",
    syncTo: isZh ? "同步到" : "Sync to",
    comingSoon: isZh ? "即将上线" : "Coming Soon",
  };

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/products?${params}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [search]);

  useEffect(() => {
    if (user) fetchProducts();
  }, [user, fetchProducts]);

  function openForm(product?: Product) {
    if (product) {
      setEditing(product);
      setFormName(product.name);
      setFormSku(product.sku);
      setFormPrice(String(product.price));
      setFormCurrency(product.currency);
      setFormStock(String(product.stock));
      setFormCategory(product.category);
      setFormDesc(product.description);
      setFormImage(product.image_url || "");
      setFormStatus(product.status === "archived" ? "draft" : product.status);
    } else {
      setEditing(null);
      setFormName(""); setFormSku(""); setFormPrice(""); setFormCurrency("USD");
      setFormStock(""); setFormCategory(""); setFormDesc(""); setFormImage(""); setFormStatus("draft");
    }
    setShowForm(true);
  }

  async function saveProduct() {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editing ? "update" : "create",
          id: editing?.id,
          name: formName.trim(),
          sku: formSku.trim(),
          price: parseFloat(formPrice) || 0,
          currency: formCurrency,
          stock: parseInt(formStock) || 0,
          category: formCategory.trim(),
          description: formDesc.trim(),
          image_url: formImage.trim() || null,
          status: formStatus,
        }),
      });
      setShowForm(false);
      fetchProducts();
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function deleteProduct(id: number) {
    if (!confirm(isZh ? "确定删除此产品？" : "Delete this product?")) return;
    await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    fetchProducts();
  }

  const activeCount = products.filter((p) => p.status === "active").length;
  const totalStock = products.reduce((sum, p) => sum + p.stock, 0);
  const filtered = search
    ? products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()))
    : products;

  return (
    <DashboardShell user={user || {}}>
      <div className="max-w-[1200px] mx-auto p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">{t.title}</h1>
            <p className="text-sm text-gray-500">{t.subtitle}</p>
          </div>
          <button onClick={() => openForm()} className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium cursor-pointer">{t.addProduct}</button>
        </div>

        {/* Stats */}
        {products.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400">{t.totalProducts}</p>
              <p className="text-2xl font-bold text-gray-900">{products.length}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400">{t.activeProducts}</p>
              <p className="text-2xl font-bold text-green-600">{activeCount}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400">{t.totalStock}</p>
              <p className="text-2xl font-bold text-blue-600">{totalStock.toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            className="w-full sm:w-80 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        {/* Products */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">{t.loading}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{products.length === 0 ? t.noProducts : (isZh ? "无匹配结果" : "No matches")}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <div key={p.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow">
                {p.image_url && (
                  <div className="h-40 bg-gray-100 flex items-center justify-center overflow-hidden">
                    <img src={p.image_url} alt={p.name} className="object-cover w-full h-full" />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-gray-900 line-clamp-1">{p.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${p.status === "active" ? "bg-green-100 text-green-700" : p.status === "draft" ? "bg-gray-100 text-gray-600" : "bg-red-100 text-red-600"}`}>
                      {p.status === "active" ? t.active : p.status === "draft" ? t.draft : t.archived}
                    </span>
                  </div>
                  {p.sku && <p className="text-xs text-gray-400 mb-1">SKU: {p.sku}</p>}
                  {p.category && <p className="text-xs text-gray-400 mb-2">{p.category}</p>}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg font-bold text-gray-900">{p.currency} {p.price.toFixed(2)}</span>
                    <span className="text-xs text-gray-500">{t.stock}: {p.stock}</span>
                  </div>

                  {/* Channel sync badges */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200">Amazon <span className="text-orange-400">{t.comingSoon}</span></span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">DK Wholesale <span className="text-blue-400">{t.comingSoon}</span></span>
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-gray-100">
                    <button onClick={() => openForm(p)} className="text-xs text-red-600 hover:text-red-800 cursor-pointer">{t.editProduct}</button>
                    <button onClick={() => deleteProduct(p.id)} className="text-xs text-gray-400 hover:text-red-600 cursor-pointer ml-auto">{t.delete}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-4">{editing ? t.editProduct : t.addProduct}</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">{t.name} *</label>
                  <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t.sku}</label>
                    <input type="text" value={formSku} onChange={(e) => setFormSku(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t.category}</label>
                    <input type="text" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t.price}</label>
                    <input type="number" step="0.01" value={formPrice} onChange={(e) => setFormPrice(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Currency</label>
                    <select value={formCurrency} onChange={(e) => setFormCurrency(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm cursor-pointer">
                      <option>USD</option><option>EUR</option><option>GBP</option><option>CNY</option><option>JPY</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t.stock}</label>
                    <input type="number" value={formStock} onChange={(e) => setFormStock(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">{t.description}</label>
                  <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">{t.imageUrl}</label>
                  <input type="url" value={formImage} onChange={(e) => setFormImage(e.target.value)} placeholder="https://..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">{t.status}</label>
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as "active" | "draft")} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm cursor-pointer">
                    <option value="draft">{t.draft}</option>
                    <option value="active">{t.active}</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 cursor-pointer">{t.cancel}</button>
                <button onClick={saveProduct} disabled={saving || !formName.trim()} className="bg-red-700 hover:bg-red-800 disabled:bg-gray-300 text-white px-6 py-2 rounded-lg text-sm font-medium cursor-pointer">
                  {saving ? "..." : t.save}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
