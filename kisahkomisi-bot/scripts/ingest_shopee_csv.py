#!/usr/bin/env python3
"""
scripts/ingest_shopee_csv.py
Ingests 100 fresh Shopee Affiliate products from CSV into kisahkomisi.db (product_bank)
and outputs structured JSON for the Vercel Bio Catalog website.
"""

import csv
import json
import sqlite3
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "kisahkomisi.db"
CSV_PATH = Path("/Users/kiki/Downloads/LinkProdukSekaligus20261108193649-03ad931f6489447c88b547a5dae394a6.csv")
WEB_DATA_DIR = Path("/Users/kiki/Documents/Web Develop/katalog-ceritakiki/data")
WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)

def clean_price(p_str):
    if not p_str:
        return 0, "Rp 0"
    p_str = p_str.replace('"', '').strip()
    if 'RB' in p_str:
        num = float(p_str.replace('RB', '').replace(',', '.').strip())
        val = int(num * 1000)
        return val, f"Rp {val:,}".replace(',', '.')
    try:
        val = int(p_str.replace('.', '').replace(',', ''))
        return val, f"Rp {val:,}".replace(',', '.')
    except:
        return 0, p_str

def clean_sales(s_str):
    if not s_str:
        return "10RB+ Terjual"
    s_str = s_str.strip()
    if "RB+" in s_str:
        return s_str + " Terjual"
    return s_str + " Terjual"

def categorize(name, shop):
    n = name.lower()
    if any(k in n for k in ['parfum', 'perfume', 'lip cream', 'liptint', 'lipstick', 'lip tint', 'sunscreen', 'facial', 'face wash', 'moisturizer', 'deodorant', 'body wash', 'sabun cair', 'cushion', 'bedak', 'serum', 'hair dryer', 'hair mist', 'kutek', 'bulu mata', 'tawas', 'body lotion', 'masker duckbill']):
        return 'Skincare & Perawatan'
    if any(k in n for k in ['kipas', 'case', 'kabel', 'charger', 'holder', 'stand', 'powerbank', 'tongsis', 'tripod', 'strap', 'smartwatch', 'ssd', 'magsafe']):
        return 'Elektronik & Gadget'
    if any(k in n for k in ['basreng', 'coklat', 'makaroni', 'lemon', 'muesli', 'matcha', 'nuget', 'nugget', 'chia seed', 'squishy', 'snack', 'sereal', 'oat']):
        return 'Camilan & Makanan'
    if any(k in n for k in ['tas ', 'tas selempang', 'sandal', 'sepatu', 'celana', 'pants', 'buku', 'buket', 'gantungan kunci', 'ikat pinggang', 'sajadah']):
        return 'Fashion & Outfit'
    return 'Rumah Tangga & Kosan'

def get_product_badge(price_num, sales, cat):
    if price_num <= 20000:
        return "🔥 Super Murah"
    if "10RB+" in sales:
        return "⭐ Best Seller"
    if cat == "Elektronik & Gadget":
        return "⚡ Solusi Meja Kerja"
    if cat == "Rumah Tangga & Kosan":
        return "🏠 Favorit Anak Kos"
    if cat == "Skincare & Perawatan":
        return "✨ Glow Up Murah"
    if cat == "Camilan & Makanan":
        return "🍿 Anti Stress"
    return "💡 Spill Pilihan"

def main():
    if not CSV_PATH.exists():
        print(f"Error: CSV not found at {CSV_PATH}")
        sys.exit(1)

    with open(CSV_PATH, mode="r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Loaded {len(rows)} rows from {CSV_PATH.name}")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 1. Deactivate old products
    cur.execute("UPDATE product_bank SET active = 0 WHERE active = 1;")
    old_deactivated = cur.rowcount
    print(f"Deactivated {old_deactivated} old products.")

    products_for_web = []

    for idx, r in enumerate(rows):
        prod_id = r.get("ID Produk", "").strip()
        name = r.get("Nama Produk", "").strip()
        raw_price = r.get("Harga", "").strip()
        sales_raw = r.get("Penjualan", "").strip()
        shop = r.get("Nama Toko", "").strip()
        comm_rate = r.get("Komisi hingga", "").strip()
        comm_val = r.get("Komisi", "").strip()
        prod_url = r.get("Link Produk", "").strip()
        aff_url = r.get("Link Komisi Ekstra", "").strip()

        price_num, price_fmt = clean_price(raw_price)
        sales = clean_sales(sales_raw)
        cat = categorize(name, shop)
        badge = get_product_badge(price_num, sales, cat)

        # Build clean concise description for the bot & web
        desc_payload = {
            "price_num": price_num,
            "price_formatted": price_fmt,
            "sales": sales,
            "shop": shop,
            "badge": badge,
            "commission": comm_val,
            "product_id": prod_id
        }
        desc_str = f"Harga: {price_fmt} | Terjual: {sales} | Toko: {shop}"

        # Insert into DB
        cur.execute("""
            INSERT INTO product_bank (category, name, description, affiliate_url, active, times_used)
            VALUES (?, ?, ?, ?, 1, 0)
        """, (cat, name, desc_str, aff_url))

        db_id = cur.lastrowid

        products_for_web.append({
            "id": idx + 1,
            "db_id": db_id,
            "product_id": prod_id,
            "name": name,
            "category": cat,
            "badge": badge,
            "price_num": price_num,
            "price_formatted": price_fmt,
            "sales": sales,
            "shop": shop,
            "commission": comm_val,
            "product_url": prod_url,
            "affiliate_url": aff_url
        })

    conn.commit()
    conn.close()

    # Save to JSON for Web Catalog
    json_path = WEB_DATA_DIR / "products.json"
    with open(json_path, "w", encoding="utf-8") as jf:
        json.dump(products_for_web, jf, indent=2, ensure_ascii=False)

    print(f"✅ Successfully inserted {len(products_for_web)} products into {DB_PATH}")
    print(f"✅ Generated web catalog data at {json_path}")

if __name__ == "__main__":
    main()
