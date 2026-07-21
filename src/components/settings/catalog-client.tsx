"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Category = { id: string; name: string; description: string | null; isGeneral: boolean };
type Product = { id: string; sku: string | null; name: string; description: string | null; price: number; stock: number; active: boolean; categoryId: string };
async function errorMessage(res: Response) { const data = await res.json().catch(() => null) as { error?: { message?: string } } | null; return data?.error?.message ?? "No se pudo guardar."; }

export function CatalogClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [product, setProduct] = useState({ sku: "", name: "", description: "", price: "0", stock: "0", categoryId: "", active: true });
  const refetch = useCallback(async () => {
    const [cats, prods] = await Promise.all([fetch("/api/catalog/categories"), fetch("/api/catalog/products")]);
    if (cats.ok) { const data = await cats.json() as { categories: Category[] }; setCategories(data.categories); setProduct((v) => v.categoryId ? v : { ...v, categoryId: data.categories[0]?.id ?? "" }); }
    if (prods.ok) setProducts((await prods.json() as { products: Product[] }).products);
  }, []);
  useEffect(() => { void refetch(); }, [refetch]);
  async function createCategory() {
    setMessage(null); const res = await fetch("/api/catalog/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: categoryName }) });
    if (!res.ok) { setMessage(await errorMessage(res)); return; } setCategoryName(""); await refetch();
  }
  async function removeCategory(category: Category) {
    if (!window.confirm(`Los productos de ${category.name} se moverán a General. ¿Continuar?`)) return;
    const res = await fetch(`/api/catalog/categories/${category.id}`, { method: "DELETE" });
    if (!res.ok) { setMessage(await errorMessage(res)); return; } await refetch();
  }
  async function editCategory(category: Category) {
    const name = window.prompt("Nombre de categoría", category.name); if (!name?.trim()) return;
    const res = await fetch(`/api/catalog/categories/${category.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description: category.description }) });
    if (!res.ok) { setMessage(await errorMessage(res)); return; } await refetch();
  }
  async function createProduct() {
    setMessage(null); const res = await fetch("/api/catalog/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...product, price: Number(product.price), stock: Number(product.stock) }) });
    if (!res.ok) { setMessage(await errorMessage(res)); return; }
    setProduct((v) => ({ ...v, sku: "", name: "", description: "", price: "0", stock: "0" })); await refetch();
  }
  async function removeProduct(id: string) { const res = await fetch(`/api/catalog/products/${id}`, { method: "DELETE" }); if (!res.ok) { setMessage(await errorMessage(res)); return; } await refetch(); }
  async function editProduct(item: Product) {
    const name = window.prompt("Nombre de producto", item.name); if (!name?.trim()) return;
    const description = window.prompt("Presentación", item.description ?? ""); if (description === null) return;
    const res = await fetch(`/api/catalog/products/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku: item.sku ?? "", name, description, price: item.price, stock: item.stock, active: item.active, categoryId: item.categoryId }) });
    if (!res.ok) { setMessage(await errorMessage(res)); return; } await refetch();
  }
  return <div className="max-w-4xl space-y-6">
    <p className="text-sm text-muted-foreground">Administra categorías y productos de esta organización. General protege el inventario al eliminar categorías.</p>
    {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
    <Card><CardHeader><CardTitle>Categorías ({categories.length} de 9)</CardTitle></CardHeader><CardContent className="space-y-3">
      <div data-testid="category-form" className="flex gap-2"><Input aria-label="Nombre de categoría" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} /><Button onClick={() => void createCategory()} disabled={!categoryName.trim() || categories.length >= 9}>Crear categoría</Button></div>
      {categories.map((c) => <div key={c.id} className="flex items-center justify-between rounded border p-3" data-testid={c.isGeneral ? "category-general" : undefined}><div><strong className="capitalize">{c.name}</strong>{c.isGeneral && <span className="ml-2 text-xs text-muted-foreground">Respaldo</span>}<p className="text-xs text-muted-foreground">{c.description}</p></div><div className="flex gap-2"><Button variant="outline" disabled={c.isGeneral} onClick={() => void editCategory(c)}>Editar</Button><Button variant="outline" aria-label={`Eliminar ${c.name}`} disabled={c.isGeneral} onClick={() => void removeCategory(c)}>Eliminar</Button></div></div>)}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Productos</CardTitle></CardHeader><CardContent className="space-y-3">
      <div data-testid="product-form" className="grid gap-2 md:grid-cols-6"><Input aria-label="SKU" placeholder="SKU (opcional)" value={product.sku} onChange={(e) => setProduct({ ...product, sku: e.target.value })}/><Input aria-label="Nombre de producto" placeholder="Nombre" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })}/><Input aria-label="Presentación" placeholder="Presentación (ej. 500 ml)" value={product.description} onChange={(e) => setProduct({ ...product, description: e.target.value })}/><Input aria-label="Precio en centavos" type="number" value={product.price} onChange={(e) => setProduct({ ...product, price: e.target.value })}/><Input aria-label="Stock" type="number" value={product.stock} onChange={(e) => setProduct({ ...product, stock: e.target.value })}/><select data-testid="product-category-select" aria-label="Categoría" value={product.categoryId} onChange={(e) => setProduct({ ...product, categoryId: e.target.value })} className="rounded-md border bg-card px-2">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <Button onClick={() => void createProduct()} disabled={!product.name.trim() || !product.categoryId}>Crear producto</Button>
      <div className="overflow-x-auto rounded border"><table className="w-full text-sm"><thead className="bg-panel text-left text-text-2"><tr><th className="p-3">Producto</th><th className="p-3">Presentación</th><th className="p-3">SKU</th><th className="p-3">Precio</th><th className="p-3">Stock</th><th className="p-3">Acciones</th></tr></thead><tbody>{products.map((p) => <tr key={p.id} className="border-t"><td className="p-3 font-medium">{p.name}</td><td className="p-3">{p.description || "—"}</td><td className="p-3 font-mono">{p.sku || "—"}</td><td className="p-3">${(p.price / 100).toFixed(2)}</td><td className="p-3">{p.stock}</td><td className="p-3"><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void editProduct(p)}>Editar</Button><Button variant="outline" size="sm" onClick={() => void removeProduct(p.id)}>Eliminar</Button></div></td></tr>)}</tbody></table></div>
    </CardContent></Card>
  </div>;
}
