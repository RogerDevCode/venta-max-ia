"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2, Plus, Check, X, HelpCircle, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Category = { id: string; name: string; description: string | null; isGeneral: boolean };
type Product = { id: string; sku: string | null; name: string; description: string | null; price: number; stock: number; active: boolean; categoryId: string };

async function errorMessage(res: Response) {
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? "No se pudo guardar la operación.";
}

export function CatalogClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categoryMessage, setCategoryMessage] = useState<string | null>(null);
  const [productMessage, setProductMessage] = useState<string | null>(null);

  // Categorías
  const [categoryName, setCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  // Productos
  const [product, setProduct] = useState({
    sku: "",
    name: "",
    description: "",
    price: "0",
    stock: "0",
    categoryId: "",
    active: true,
  });
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [improvingCategory, setImprovingCategory] = useState(false);
  const [improvingProduct, setImprovingProduct] = useState(false);

  const refetch = useCallback(async () => {
    const [catsRes, prodsRes] = await Promise.all([
      fetch("/api/catalog/categories"),
      fetch("/api/catalog/products"),
    ]);

    if (catsRes.ok) {
      const data = (await catsRes.json()) as { categories: Category[] };
      setCategories(data.categories);
      setProduct((v) => (v.categoryId ? v : { ...v, categoryId: data.categories[0]?.id ?? "" }));
    }

    if (prodsRes.ok) {
      const data = (await prodsRes.json()) as { products: Product[] };
      setProducts(data.products);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Acciones de categoría
  async function createCategory() {
    setCategoryMessage(null);
    if (!categoryName.trim()) return;
    const res = await fetch("/api/catalog/categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: categoryName }),
    });
    if (!res.ok) {
      setCategoryMessage(`⚠️ ${await errorMessage(res)}`);
      return;
    }
    setCategoryName("");
    await refetch();
    setCategoryMessage("✅ Categoría creada correctamente.");
  }

  async function removeCategory(category: Category) {
    if (!window.confirm(`Los productos de "${category.name}" se moverán automáticamente a la categoría General. ¿Continuar?`)) {
      return;
    }
    setCategoryMessage(null);
    const res = await fetch(`/api/catalog/categories/${category.id}`, { method: "DELETE" });
    if (!res.ok) {
      setCategoryMessage(`⚠️ ${await errorMessage(res)}`);
      return;
    }
    await refetch();
    setCategoryMessage(`✅ Categoría "${category.name}" eliminada.`);
  }

  async function startEditCategory(category: Category) {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
  }

  async function saveEditCategory(category: Category) {
    if (!editingCategoryName.trim()) return;
    setCategoryMessage(null);
    const res = await fetch(`/api/catalog/categories/${category.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: editingCategoryName, description: category.description }),
    });
    if (!res.ok) {
      setCategoryMessage(`⚠️ ${await errorMessage(res)}`);
      return;
    }
    setEditingCategoryId(null);
    await refetch();
    setCategoryMessage("✅ Categoría actualizada.");
  }

  // Acciones de producto con validación e interfaz de edición inline
  function startEditProduct(item: Product) {
    setProductMessage(null);
    setEditingProductId(item.id);
    setProduct({
      sku: item.sku ?? "",
      name: item.name,
      description: item.description ?? "",
      price: String(item.price),
      stock: String(item.stock),
      categoryId: item.categoryId,
      active: item.active,
    });
    // Enfocar o desplazar al formulario superior si se edita
    const formEl = document.getElementById("product-form");
    if (formEl) formEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resetProductForm() {
    setEditingProductId(null);
    setProduct({
      sku: "",
      name: "",
      description: "",
      price: "0",
      stock: "0",
      categoryId: categories[0]?.id ?? "",
      active: true,
    });
  }

  function cancelEditProduct() {
    resetProductForm();
    setProductMessage(null);
  }

  async function validateAndSubmitProduct() {
    setProductMessage(null);

    // Validaciones
    if (!product.name.trim()) {
      setProductMessage("⚠️ El nombre del producto es obligatorio (no puede quedar en blanco).");
      return;
    }
    if (!product.categoryId) {
      setProductMessage("⚠️ Debes seleccionar una categoría para el producto.");
      return;
    }
    const priceNum = Number(product.price);
    if (!Number.isInteger(priceNum) || priceNum < 0) {
      setProductMessage("⚠️ El precio debe ser un número entero mayor o igual a 0 en pesos chilenos exactos (CLP), sin decimales ni centavos.");
      return;
    }
    const stockNum = Number(product.stock);
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      setProductMessage("⚠️ El stock disponible debe ser un número entero mayor o igual a 0.");
      return;
    }

    const payload = {
      sku: product.sku.trim() || null,
      name: product.name.trim(),
      description: product.description.trim() || null,
      price: priceNum,
      stock: stockNum,
      categoryId: product.categoryId,
      active: product.active,
    };

    if (editingProductId) {
      const res = await fetch(`/api/catalog/products/${editingProductId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setProductMessage(`⚠️ ${await errorMessage(res)}`);
        return;
      }
      resetProductForm();
      await refetch();
      setProductMessage(`✅ Producto "${product.name}" modificado correctamente.`);
    } else {
      const res = await fetch("/api/catalog/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setProductMessage(`⚠️ ${await errorMessage(res)}`);
        return;
      }
      resetProductForm();
      await refetch();
      setProductMessage(`✅ Producto "${product.name}" creado y agregado al catálogo.`);
    }
  }

  async function removeProduct(id: string, name: string) {
    if (!window.confirm(`¿Estás seguro de eliminar el producto "${name}" del catálogo?`)) return;
    setProductMessage(null);
    const res = await fetch(`/api/catalog/products/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setProductMessage(`⚠️ ${await errorMessage(res)}`);
      return;
    }
    if (editingProductId === id) resetProductForm();
    await refetch();
    setProductMessage(`✅ Producto "${name}" eliminado.`);
  }

  async function reviewCategoryText() {
    const textToCheck = editingCategoryId ? editingCategoryName : categoryName;
    if (!textToCheck.trim()) {
      setCategoryMessage("⚠️ Ingresa el nombre de la categoría para revisar su ortografía.");
      return;
    }
    setImprovingCategory(true);
    setCategoryMessage("⌛ Revisando ortografía y redacción con IA...");
    try {
      const res = await fetch("/api/kb/improve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "category",
          content: textToCheck.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.improved?.content !== undefined) {
        const corrected = data.improved.content;
        if (editingCategoryId) {
          setEditingCategoryName(corrected);
        } else {
          setCategoryName(corrected);
        }
        if (corrected.trim().toLowerCase() === textToCheck.trim().toLowerCase() && corrected.trim() === textToCheck.trim()) {
          setCategoryMessage("✨ Ortografía verificada: el texto es correcto.");
        } else {
          setCategoryMessage(`✨ Ortografía corregida automáticamente por la IA: "${corrected}".`);
        }
      } else {
        setCategoryMessage("⚠️ No se pudo revisar el texto con IA en este momento.");
      }
    } catch {
      setCategoryMessage("⚠️ Error de conexión al consultar el corrector IA.");
    } finally {
      setImprovingCategory(false);
    }
  }

  async function reviewProductText() {
    if (!product.name.trim() && !product.description.trim()) {
      setProductMessage("⚠️ Ingresa el nombre o la descripción del producto para revisar su ortografía.");
      return;
    }
    setImprovingProduct(true);
    setProductMessage("⌛ Revisando ortografía y redacción con IA...");
    try {
      const res = await fetch("/api/kb/improve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "product",
          name: product.name.trim(),
          description: product.description.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.improved) {
        const correctedName = data.improved.name !== undefined ? data.improved.name : product.name;
        const correctedDesc = data.improved.description !== undefined ? data.improved.description : product.description;
        setProduct((prev) => ({
          ...prev,
          name: correctedName,
          description: correctedDesc,
        }));
        setProductMessage("✨ ¡Ortografía y redacción del producto corregidas automáticamente por la IA!");
      } else {
        setProductMessage("⚠️ No se pudo revisar el texto del producto con IA en este momento.");
      }
    } catch {
      setProductMessage("⚠️ Error de conexión al consultar el corrector IA.");
    } finally {
      setImprovingProduct(false);
    }
  }

  const sortedProducts = [...products].sort((a, b) => {
    const catA = categories.find((c) => c.id === a.categoryId)?.name ?? "Sin categoría";
    const catB = categories.find((c) => c.id === b.categoryId)?.name ?? "Sin categoría";
    const catCompare = catA.localeCompare(catB, "es");
    if (catCompare !== 0) return catCompare;

    const nameCompare = a.name.localeCompare(b.name, "es");
    if (nameCompare !== 0) return nameCompare;

    const descA = a.description ?? "";
    const descB = b.description ?? "";
    return descA.localeCompare(descB, "es");
  });

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Catálogo y Productos</h1>
        <p className="text-sm text-muted-foreground">
          Administra las categorías e inventario de este negocio. Los productos son consultados y mostrados en tiempo real por el agente de IA a tus clientes.
        </p>
      </div>

      {/* SECCIÓN CATEGORÍAS */}
      <Card>
        <CardHeader>
          <CardTitle>Categorías ({categories.length} de 9 máximas)</CardTitle>
          <CardDescription>
            Agrupa tus productos por familias (ej. Licores, Vinos, Promociones). La categoría &quot;General&quot; protege los productos si se elimina una categoría.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div data-testid="category-form" className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px] space-y-1.5">
              <Label htmlFor="cat-name" className="flex items-center gap-1.5 text-xs font-semibold">
                Nombre de la categoría *
                <span title="Ingresa el nombre o familia en la que clasificarás tus productos (ej. Licores, Vinos, Cervezas)." className="inline-flex cursor-help">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </Label>
              <Input
                id="cat-name"
                aria-label="Nombre de categoría"
                lang="es"
                spellCheck
                placeholder="Ej. Bebidas sin alcohol"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                title="Nombre principal de la familia de productos en el catálogo."
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" type="button" onClick={() => void reviewCategoryText()} disabled={improvingCategory || (!categoryName.trim() && !editingCategoryId)} title="Sugerencia de revisión ortográfica">
                {improvingCategory ? "Revisando..." : "Revisar texto"}
              </Button>
              <Button
                type="button"
                onClick={() => void createCategory()}
                disabled={!categoryName.trim() || categories.length >= 9}
                title="Crear y añadir esta categoría al catálogo"
              >
                <Plus className="mr-1 h-4 w-4" /> Crear categoría
              </Button>
            </div>
          </div>

          {categoryMessage && (
            <div
              role="alert"
              className={`rounded-md border p-3 text-sm font-medium ${
                categoryMessage.startsWith("⚠️")
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : categoryMessage.startsWith("✅")
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-border bg-panel/50 text-foreground"
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{categoryMessage}</span>
                <Button variant="ghost" size="sm" onClick={() => setCategoryMessage(null)} className="h-6 px-2 text-xs">
                  Ocultar
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 pt-2">
            {categories.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg border bg-panel/30 p-3 transition-colors hover:bg-panel/50"
                data-testid={c.isGeneral ? "category-general" : undefined}
              >
                {editingCategoryId === c.id ? (
                  <div className="flex flex-1 items-center gap-1 mr-2">
                    <Input
                      size={1}
                      className="h-8 text-sm"
                      value={editingCategoryName}
                      onChange={(e) => setEditingCategoryName(e.target.value)}
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-amber-400 hover:text-amber-300" disabled={improvingCategory} onClick={() => void reviewCategoryText()} title="Corregir ortografía con IA">
                      <Wand2 className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-emerald-400" onClick={() => void saveEditCategory(c)} title="Guardar cambios">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => setEditingCategoryId(null)} title="Cancelar">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-sm font-medium capitalize">{c.name}</strong>
                      {c.isGeneral && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase">
                          Respaldo
                        </span>
                      )}
                    </div>
                    {c.description && <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>}
                  </div>
                )}

                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    disabled={c.isGeneral || editingCategoryId === c.id}
                    onClick={() => void startEditCategory(c)}
                    title="Editar nombre de esta categoría"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                    aria-label={`Eliminar ${c.name}`}
                    disabled={c.isGeneral}
                    onClick={() => void removeCategory(c)}
                    title={`Eliminar categoría ${c.name} (los productos pasarán a General)`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* SECCIÓN PRODUCTOS */}
      <Card id="product-form">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{editingProductId ? "✏️ Modificar Producto" : "Agregar Nuevo Producto"}</CardTitle>
              <CardDescription>
                {editingProductId
                  ? "Revisa los campos cargados y guarda los cambios para este producto en el catálogo."
                  : "Completa la información con títulos claros, códigos y montos exactos para ingresar un producto al inventario."}
              </CardDescription>
            </div>
            {editingProductId && (
              <Button variant="outline" size="sm" onClick={cancelEditProduct} className="text-xs">
                <X className="mr-1 h-3.5 w-3.5" /> Cancelar edición
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div data-testid="product-form" className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 bg-panel/30 p-4 rounded-lg border">
            {/* SKU */}
            <div className="space-y-1.5">
              <Label htmlFor="prod-sku" className="flex items-center gap-1.5 text-xs font-semibold">
                SKU / Código (Opcional)
                <span title="Código único, referencia interna o de barras del producto (ej. RON-500). Puede dejarse en blanco." className="inline-flex cursor-help">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </Label>
              <Input
                id="prod-sku"
                aria-label="SKU"
                placeholder="Ej. RON-750ML"
                value={product.sku}
                onChange={(e) => setProduct({ ...product, sku: e.target.value })}
                title="Código o referencia interna de inventario del producto."
              />
            </div>

            {/* Nombre */}
            <div className="space-y-1.5">
              <Label htmlFor="prod-name" className="flex items-center gap-1.5 text-xs font-semibold">
                Nombre del producto *
                <span title="Nombre comercial exacto con el que el cliente identificará o consultará este producto al bot (ej. Ron Pampero Aniversario)." className="inline-flex cursor-help">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </Label>
              <Input
                id="prod-name"
                aria-label="Nombre de producto"
                lang="es"
                spellCheck
                placeholder="Ej. Ron Pampero Aniversario"
                value={product.name}
                onChange={(e) => setProduct({ ...product, name: e.target.value })}
                title="Nombre principal y descriptivo del producto."
              />
            </div>

            {/* Presentación */}
            <div className="space-y-1.5">
              <Label htmlFor="prod-desc" className="flex items-center gap-1.5 text-xs font-semibold">
                Presentación / Detalle (Opcional)
                <span title="Tamaño, volumen, peso o nota breve del producto (ej. Botella 750 ml, Pack 6 latas, Caja cerrada)." className="inline-flex cursor-help">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </Label>
              <Input
                id="prod-desc"
                aria-label="Presentación"
                lang="es"
                spellCheck
                placeholder="Ej. Botella de vidrio 750 ml"
                value={product.description}
                onChange={(e) => setProduct({ ...product, description: e.target.value })}
                title="Detalle del formato o presentación del producto."
              />
            </div>

            {/* Categoría */}
            <div className="space-y-1.5">
              <Label htmlFor="prod-cat" className="flex items-center gap-1.5 text-xs font-semibold">
                Categoría *
                <span title="Selecciona la categoría del catálogo en la que se agrupará este producto." className="inline-flex cursor-help">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </Label>
              <select
                id="prod-cat"
                data-testid="product-category-select"
                aria-label="Categoría"
                value={product.categoryId}
                onChange={(e) => setProduct({ ...product, categoryId: e.target.value })}
                className="w-full h-9 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title="Familia o categoría a la que pertenece el producto."
              >
                <option value="" disabled>-- Selecciona una categoría --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Precio en pesos chilenos CLP */}
            <div className="space-y-1.5">
              <Label htmlFor="prod-price" className="flex items-center gap-1.5 text-xs font-semibold">
                Precio en pesos (CLP) *
                <span title="Ingresa el precio en pesos chilenos (CLP) como número entero exacto, sin centavos ni decimales. Ejemplo: para $3.500 CLP ingresa 3500." className="inline-flex cursor-help">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </Label>
              <div className="relative">
                <Input
                  id="prod-price"
                  aria-label="Precio en pesos CLP"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Ej. 3500"
                  value={product.price}
                  onChange={(e) => setProduct({ ...product, price: e.target.value })}
                  title="Monto exacto en pesos chilenos (CLP) enteros, sin puntos ni decimales."
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Equivale a: <strong className="text-foreground">${Number(product.price || 0).toLocaleString("es-CL")} CLP</strong>
              </p>
            </div>

            {/* Stock */}
            <div className="space-y-1.5">
              <Label htmlFor="prod-stock" className="flex items-center gap-1.5 text-xs font-semibold">
                Stock disponible *
                <span title="Cantidad exacta actual de unidades disponibles para venta inmediata en el inventario." className="inline-flex cursor-help">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </Label>
              <Input
                id="prod-stock"
                aria-label="Stock"
                type="number"
                min="0"
                step="1"
                placeholder="Ej. 25"
                value={product.stock}
                onChange={(e) => setProduct({ ...product, stock: e.target.value })}
                title="Cantidad de unidades disponibles."
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" type="button" onClick={() => void reviewProductText()} disabled={improvingProduct || (!product.name.trim() && !product.description.trim())} className="text-xs">
              {improvingProduct ? "Revisando..." : "Sugerencia ortográfica"}
            </Button>
            <div className="flex gap-2">
              {editingProductId && (
                <Button variant="ghost" type="button" onClick={cancelEditProduct}>
                  Cancelar
                </Button>
              )}
              <Button type="button" onClick={() => void validateAndSubmitProduct()}>
                {editingProductId ? (
                  <>
                    <Check className="mr-1.5 h-4 w-4" /> Guardar modificación
                  </>
                ) : (
                  <>
                    <Plus className="mr-1.5 h-4 w-4" /> Crear producto
                  </>
                )}
              </Button>
            </div>
          </div>

          {productMessage && (
            <div
              role="alert"
              className={`rounded-md border p-3 text-sm font-medium ${
                productMessage.startsWith("⚠️")
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : productMessage.startsWith("✅")
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-border bg-panel/50 text-foreground"
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{productMessage}</span>
                <Button variant="ghost" size="sm" onClick={() => setProductMessage(null)} className="h-6 px-2 text-xs">
                  Ocultar
                </Button>
              </div>
            </div>
          )}

          {/* TABLA DE PRODUCTOS */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Listado de Productos ({products.length})</h3>
              <span className="text-xs text-muted-foreground">Ordenados por categoría, producto y presentación</span>
            </div>
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-panel/80 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b">
                  <tr>
                    <th className="p-3">Categoría</th>
                    <th className="p-3">Producto</th>
                    <th className="p-3">Presentación</th>
                    <th className="p-3 text-right">Precio</th>
                    <th className="p-3 text-center">Stock</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        No hay productos en el catálogo. Utiliza el formulario superior para añadir tu primer producto.
                      </td>
                    </tr>
                  ) : (
                    sortedProducts.map((p) => {
                      const categoryObj = categories.find((c) => c.id === p.categoryId);
                      return (
                        <tr key={p.id} className="transition-colors hover:bg-panel/30">
                          <td className="p-3">
                            <span className="inline-flex items-center rounded-md bg-panel px-2 py-1 text-xs font-medium text-muted-foreground border">
                              {categoryObj?.name ?? "Sin categoría"}
                            </span>
                          </td>
                          <td className="p-3 font-medium text-foreground">{p.name}</td>
                          <td className="p-3 text-muted-foreground">{p.description || "—"}</td>
                          <td className="p-3 text-right font-mono font-medium">${p.price.toLocaleString("es-CL")} CLP</td>
                          <td className="p-3 text-center">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                                p.stock === 0
                                  ? "bg-destructive/20 text-destructive"
                                  : p.stock < 5
                                    ? "bg-amber-500/20 text-amber-400"
                                    : "bg-emerald-500/20 text-emerald-400"
                              }`}
                            >
                              {p.stock}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 px-2.5 text-xs font-medium"
                                onClick={() => startEditProduct(p)}
                                title={`Editar producto "${p.name}" en el formulario superior`}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => void removeProduct(p.id, p.name)}
                                title={`Eliminar producto "${p.name}" del catálogo`}
                              >
                                <Trash2 className="mr-1 h-3.5 w-3.5" /> Eliminar
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

