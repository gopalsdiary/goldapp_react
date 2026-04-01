-- =============================================
-- GOLDSMITH ACCOUNTING - COMPLETE SQL SCHEMA
-- Run this in Supabase SQL Editor
-- =============================================

-- Drop old tables if needed (uncomment if re-creating)
-- DROP TABLE IF EXISTS transactions, sales, purchases;

-- ============================================
-- 1. PRODUCTS TABLE (পণ্য - IID সহ)
-- প্রতিটি পণ্যের একটি ছোট IID থাকবে
-- ক্রয় → স্টক → বিক্রয় ট্র্যাক করা যাবে
-- ============================================
CREATE TABLE IF NOT EXISTS products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    iid INT GENERATED ALWAYS AS IDENTITY (START WITH 1001),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    -- Product Info
    item_name TEXT NOT NULL,
    weight_gm NUMERIC(15,3) DEFAULT 0,
    karat TEXT CHECK (karat IN ('18K','21K','22K','24K')),

    -- Purchase Info (কেনার সময়ের তথ্য)
    purchase_rate NUMERIC(15,2) DEFAULT 0,
    purchase_making NUMERIC(15,2) DEFAULT 0,
    purchase_vori NUMERIC(15,3) DEFAULT 0,
    purchase_total NUMERIC(15,2) DEFAULT 0,

    -- Sale Info (বিক্রির সময়ে আপডেট হবে)(sale_rate এর পরিবর্তে sale_vori)
    sale_vori NUMERIC(15,2),  (sale_rate)
    sale_making NUMERIC(15,2),
    sale_discount NUMERIC(15,2) DEFAULT 0,
    sale_total NUMERIC(15,2),
    sold_at TIMESTAMPTZ,

    -- Status & Profit
    status TEXT DEFAULT 'in_stock' CHECK (status IN ('in_stock','sold','returned')),
    profit NUMERIC(15,2),
    payment_method TEXT DEFAULT 'Cash' CHECK (payment_method IN ('Cash','Card','Mobile Banking')),
    sale_payment_method TEXT CHECK (sale_payment_method IN ('Cash','Card','Mobile Banking')),
    remarks TEXT,

    CONSTRAINT unique_iid UNIQUE (iid)
);

-- ============================================
-- 2. EXPENSES TABLE (খরচ)
-- ============================================
CREATE TABLE IF NOT EXISTS expenses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    payment_method TEXT DEFAULT 'Cash' CHECK (payment_method IN ('Cash','Card','Mobile Banking')),
    remarks TEXT
);

-- ============================================
-- 3. INDEXES
-- ============================================
CREATE INDEX idx_products_user ON products(user_id, created_at);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_iid ON products(iid);
CREATE INDEX idx_expenses_user ON expenses(user_id, created_at);

-- ============================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own products" ON products FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

CREATE POLICY "Users manage own expenses" ON expenses FOR ALL TO authenticated
    USING (true) WITH CHECK (true);
