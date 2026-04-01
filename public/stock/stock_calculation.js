// --- Ensure Supabase is initialized before proceeding ---
async function ensureSupabaseReady() {
    let retries = 0;
    while (!window.kbSupabaseClient && retries < 50) {
        await new Promise(r => setTimeout(r, 100));
        retries++;
    }
    return window.kbSupabaseClient;
}
let db = null;
// Initialize database connection
ensureSupabaseReady().then(client => {
    db = client;
    console.log('✓ Supabase client initialized');
}).catch(err => {
    console.error('✗ Failed to initialize Supabase:', err);
});
let currentSellProduct = null;
let trackTimer;
const ADMIN_PW = "11223";
const VORI_IN_GRAM = 11.664;
function byId(id) {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Element not found: #${id}`);
    }
    return el;
}
function maybeById(id) {
    return document.getElementById(id);
}
function getFieldValue(id) {
    const el = byId(id);
    return el.value;
}
function setFieldValue(id, value) {
    const el = byId(id);
    el.value = value;
}
function toNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}
function tk(n) {
    return toNum(n).toLocaleString("en-IN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}
function escapeJs(value) {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\r/g, "")
        .replace(/\n/g, " ");
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function show() {
    var _a;
    (_a = maybeById("lov")) === null || _a === void 0 ? void 0 : _a.classList.add("show");
}
function hide() {
    var _a;
    (_a = maybeById("lov")) === null || _a === void 0 ? void 0 : _a.classList.remove("show");
}
function getRange(period) {
    const now = new Date();
    let from;
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    switch (period) {
        case "today":
            from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        case "week": {
            from = new Date(now);
            from.setDate(now.getDate() - now.getDay());
            from.setHours(0, 0, 0, 0);
            break;
        }
        case "month":
            from = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        case "year":
            from = new Date(now.getFullYear(), 0, 1);
            break;
        default:
            from = new Date(2020, 0, 1);
    }
    return { from: from.toISOString(), to: to.toISOString() };
}
async function initApp() {
    // CRITICAL: Ensure Supabase is ready and establish db connection
    const client = await ensureSupabaseReady();
    if (client) {
        db = client;
        console.log('✓ Database connection established in initApp');
    }
    else {
        console.error('✗ Failed to get Supabase client');
        throw new Error('Supabase client not available');
    }
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
            regs.forEach((reg) => reg.unregister());
        }).catch((err) => {
            console.warn("Failed to unregister service worker", err);
        });
    }
    if (!localStorage.getItem("supabase_access_token")) {
        window.location.href = "../admin/login.html";
        return;
    }
    const today = new Date().toISOString().split("T")[0];
    setFieldValue("bDate", today);
    setFieldValue("eDate", today);
    void loadDash();
    void populateItemDropdown();
}
// Babel runs scripts after DOMContentLoaded/load, so we must init immediately
if (document.readyState === "complete" || document.readyState === "interactive") {
    initApp().catch(e => console.error("Init failed:", e));
}
else {
    window.addEventListener("load", () => initApp().catch(e => console.error("Init failed:", e)));
}
function go(id, el) {
    var _a;
    document.querySelectorAll(".tc").forEach((t) => t.classList.remove("on"));
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("on"));
    (_a = maybeById(`t-${id}`)) === null || _a === void 0 ? void 0 : _a.classList.add("on");
    if (el instanceof HTMLElement) {
        el.classList.add("on");
    }
    if (id === "dash") {
        void loadDash();
    }
    if (id === "stock") {
        void loadStock();
    }
    if (id === "sell") {
        void loadRecentSales();
    }
    if (id === "exp") {
        void loadExpenses();
    }
    if (id === "rpt") {
        void loadReport();
    }
    if (id === "item") {
        void loadGoldItems();
    }
}
function calcVori() {
    const weight = toNum(getFieldValue("bW"));
    const total = toNum(getFieldValue("bTotal"));
    if (weight > 0) {
        const voriPrice = (total / weight) * VORI_IN_GRAM;
        setFieldValue("bVori", String(Math.round(voriPrice)));
    }
}
function calcTotalFromVori() {
    const weight = toNum(getFieldValue("bW"));
    const voriPrice = toNum(getFieldValue("bVori"));
    if (weight > 0) {
        const total = (voriPrice / VORI_IN_GRAM) * weight;
        setFieldValue("bTotal", String(Math.round(total)));
    }
}
function sellThis(iid) {
    var _a;
    setFieldValue("sellIID", String(iid));
    document.querySelectorAll(".tc").forEach((t) => t.classList.remove("on"));
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("on"));
    (_a = maybeById("t-sell")) === null || _a === void 0 ? void 0 : _a.classList.add("on");
    void findProduct();
}
async function loadDash() {
    var _a, _b;
    show();
    try {
        const period = byId("dp").value;
        const r = getRange(period);
        const [pRes, eRes] = await Promise.all([
            db.from("products").select("*").gte("created_at", r.from).lte("created_at", r.to).order("created_at", { ascending: false }),
            db.from("expenses").select("*").gte("created_at", r.from).lte("created_at", r.to).order("created_at", { ascending: false })
        ]);
        const prods = (_a = pRes.data) !== null && _a !== void 0 ? _a : [];
        const exps = (_b = eRes.data) !== null && _b !== void 0 ? _b : [];
        const sold = prods.filter((p) => p.status === "sold");
        const totalSales = sold.reduce((s, p) => s + toNum(p.sale_total), 0);
        const totalPurchase = prods.reduce((s, p) => s + toNum(p.purchase_total), 0);
        const totalExpense = exps.reduce((s, e) => s + toNum(e.amount), 0);
        const profit = totalSales - totalPurchase - totalExpense;
        byId("dS").textContent = tk(totalSales);
        byId("dSc").textContent = `${sold.length} items sold`;
        byId("dP").textContent = tk(totalPurchase);
        byId("dPc").textContent = `${prods.length} items`;
        byId("dE").textContent = tk(totalExpense);
        byId("dEc").textContent = `${exps.length} items`;
        byId("dPr").textContent = tk(profit);
        byId("dPr").style.color = profit >= 0 ? "var(--green)" : "var(--red)";
        const all = [
            ...prods.map((p) => ({
                d: p.created_at,
                iid: p.iid,
                type: p.status === "sold" ? "Sold" : "Stock",
                item: p.item_name,
                amt: p.status === "sold" ? p.sale_total : p.purchase_total
            })),
            ...exps.map((e) => ({
                d: e.created_at,
                iid: "-",
                type: "Expense",
                item: e.description,
                amt: e.amount
            }))
        ].sort((a, b) => new Date(b.d).getTime() - new Date(a.d).getTime()).slice(0, 25);
        byId("dRc").textContent = String(all.length);
        const bd = byId("dRb");
        bd.innerHTML = all.map((row) => {
            var _a;
            return `
			<tr>
				<td>${new Date(row.d).toLocaleDateString("en-GB")}</td>
				<td>${row.iid !== "-" ? `<span class="iid">#${row.iid}</span>` : "-"}</td>
				<td><span class="tbg ${row.type === "Sold" ? "t-sold" : row.type === "Stock" ? "t-in" : "t-exp"}">${row.type}</span></td>
				<td>${escapeHtml(String((_a = row.item) !== null && _a !== void 0 ? _a : ""))}</td>
				<td style="font-weight:700">${tk(row.amt)}</td>
			</tr>
		`;
        }).join("");
    }
    catch (e) {
        console.error(e);
    }
    finally {
        hide();
    }
}
function checkPw() {
    const p = prompt("🔐 Enter Admin Password:");
    if (p === ADMIN_PW) {
        return true;
    }
    if (p !== null) {
        alert("❌ Incorrect password!");
    }
    return false;
}
async function saveBuy(e) {
    var _a;
    e.preventDefault();
    const btn = byId("bBtn");
    btn.disabled = true;
    show();
    try {
        const masterName = getFieldValue("buyItemMaster").trim();
        const desc = getFieldValue("bDesc").trim();
        const itemName = desc ? `${masterName} - ${desc}` : masterName;
        const payload = {
            item_name: itemName,
            weight_gm: toNum(getFieldValue("bW")),
            karat: getFieldValue("bK"),
            purchase_rate: toNum(getFieldValue("bVori")),
            purchase_wastage: 0,
            purchase_making: toNum(getFieldValue("bM")),
            purchase_total: toNum(getFieldValue("bTotal")),
            payment_method: null,
            remarks: getFieldValue("bRem") || null,
            created_at: new Date(getFieldValue("bDate")).toISOString(),
            status: "in_stock"
        };
        const { data, error } = await db.from("products").insert([payload]).select();
        if (error) {
            throw new Error(error.message);
        }
        const saved = (data !== null && data !== void 0 ? data : [])[0];
        const st = byId("bSt");
        st.style.display = "block";
        st.style.background = "var(--green-bg)";
        st.style.color = "var(--green)";
        st.textContent = `✅ Saved! IID: #${(_a = saved === null || saved === void 0 ? void 0 : saved.iid) !== null && _a !== void 0 ? _a : "N/A"}`;
        setTimeout(() => {
            var _a, _b;
            const addAnother = confirm(`✅ IID #${(_a = saved === null || saved === void 0 ? void 0 : saved.iid) !== null && _a !== void 0 ? _a : "N/A"} saved! Add another?`);
            if (addAnother) {
                byId("buyForm").reset();
                setFieldValue("bDate", new Date().toISOString().split("T")[0]);
                st.style.display = "none";
            }
            else {
                const stockTab = (_b = document.querySelectorAll(".tab")[1]) !== null && _b !== void 0 ? _b : null;
                go("stock", stockTab);
            }
            btn.disabled = false;
        }, 800);
    }
    catch (err) {
        const st = byId("bSt");
        st.style.display = "block";
        st.style.background = "var(--red-bg)";
        st.style.color = "var(--red)";
        st.textContent = `❌ ${err.message}`;
        btn.disabled = false;
    }
    finally {
        hide();
    }
    return false;
}
async function loadStock() {
    show();
    try {
        const filter = byId("stockFilter").value;
        let q = db.from("products").select("*").order("created_at", { ascending: false });
        if (filter !== "all") {
            q = q.eq("status", filter);
        }
        const { data } = await q;
        const rows = data !== null && data !== void 0 ? data : [];
        byId("stockBg").textContent = String(rows.length);
        const bd = byId("stockBd");
        if (!rows.length) {
            bd.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted)">📭 No data</td></tr>';
            return;
        }
        bd.innerHTML = rows.map((r) => {
            var _a, _b, _c, _d;
            return `
			<tr>
				<td><span class="iid">#${r.iid}</span></td>
				<td>${escapeHtml((_a = r.item_name) !== null && _a !== void 0 ? _a : "")}</td>
				<td>${toNum(r.weight_gm)}g</td>
				<td>${escapeHtml((_b = r.karat) !== null && _b !== void 0 ? _b : "-")}</td>
				<td>${tk(r.purchase_total)}</td>
				<td><span class="tbg ${r.status === "sold" ? "t-sold" : "t-in"}">${r.status === "sold" ? "Sold" : "In Stock"}</span></td>
				<td class="acts">
					<button class="eb" onclick="editStock('${r.id}','${escapeJs((_c = r.item_name) !== null && _c !== void 0 ? _c : "")}',${toNum(r.weight_gm)},'${escapeJs((_d = r.karat) !== null && _d !== void 0 ? _d : "")}',${toNum(r.purchase_total)},'${escapeJs(r.status)}')">✏️</button>
					<button class="db" onclick="delEntry('products','${r.id}')">🗑️</button>
				</td>
			</tr>
		`;
        }).join("");
    }
    catch (e) {
        console.error(e);
    }
    finally {
        hide();
    }
}
async function findProduct() {
    var _a, _b, _c;
    const iid = Number.parseInt(getFieldValue("sellIID"), 10);
    if (!Number.isInteger(iid)) {
        alert("Enter a valid IID");
        return;
    }
    show();
    try {
        const { data, error } = await db.from("products").select("*").eq("iid", iid).single();
        if (error || !data) {
            throw new Error((error === null || error === void 0 ? void 0 : error.message) || "Product not found!");
        }
        if (data.status === "sold") {
            byId("sellResult").innerHTML = `
				<div class="product-card" style="border-color:var(--orange)">
					<h3>⚠️ Already Sold!</h3>
					<p>IID #${data.iid} (${escapeHtml((_a = data.item_name) !== null && _a !== void 0 ? _a : "")}) was sold on ${data.sold_at ? new Date(data.sold_at).toLocaleDateString("en-GB") : "N/A"} for ${tk(data.sale_total)}</p>
				</div>
			`;
            byId("sellForm").style.display = "none";
            return;
        }
        currentSellProduct = data;
        byId("sellResult").innerHTML = `
			<div class="product-card">
				<h3><span class="iid">#${data.iid}</span> ${escapeHtml((_b = data.item_name) !== null && _b !== void 0 ? _b : "")}</h3>
				<div class="row"><span>Weight</span><span>${toNum(data.weight_gm)}g</span></div>
				<div class="row"><span>Item Type</span><span>${escapeHtml((_c = data.karat) !== null && _c !== void 0 ? _c : "-")}</span></div>
				<div class="row"><span>Purchase Cost</span><span style="font-weight:700">${tk(data.purchase_total)}</span></div>
			</div>
		`;
        byId("sellForm").style.display = "block";
    }
    catch (err) {
        byId("sellResult").innerHTML = `<div class="product-card" style="border-color:var(--red)"><h3>❌ ${err.message}</h3></div>`;
        byId("sellForm").style.display = "none";
    }
    finally {
        hide();
    }
}
function calcSell() {
    if (!currentSellProduct) {
        return;
    }
    const voriPrice = toNum(getFieldValue("sVori"));
    const weight = toNum(currentSellProduct.weight_gm);
    const making = toNum(getFieldValue("sMk"));
    const disc = toNum(getFieldValue("sDisc"));
    const total = ((voriPrice / VORI_IN_GRAM) * weight) + making - disc;
    setFieldValue("sTotal", String(Math.round(total)));
    updSellDisp();
}
function updSellDisp() {
    // Reserved for future UI-only breakdown display.
}
async function saveSell(e) {
    e.preventDefault();
    if (!currentSellProduct) {
        return false;
    }
    const btn = byId("sBtn");
    btn.disabled = true;
    show();
    try {
        const saleTotal = toNum(getFieldValue("sTotal"));
        const profit = saleTotal - toNum(currentSellProduct.purchase_total);
        const { error } = await db.from("products").update({
            sale_rate: toNum(getFieldValue("sVori")),
            sale_making: toNum(getFieldValue("sMk")),
            sale_discount: toNum(getFieldValue("sDisc")),
            sale_total: saleTotal,
            profit,
            status: "sold",
            sold_at: new Date().toISOString(),
            sale_payment_method: getFieldValue("sPay")
        }).eq("id", currentSellProduct.id);
        if (error) {
            throw new Error(error.message);
        }
        const st = byId("sSt");
        st.style.display = "block";
        st.style.background = "var(--green-bg)";
        st.style.color = "var(--green)";
        st.textContent = `✅ Sold! Profit: ${tk(profit)}`;
        setTimeout(() => {
            var _a;
            alert(`✅ IID #${(_a = currentSellProduct === null || currentSellProduct === void 0 ? void 0 : currentSellProduct.iid) !== null && _a !== void 0 ? _a : "N/A"} sold!\nProfit: ${tk(profit)}`);
            currentSellProduct = null;
            byId("sellForm").reset();
            byId("sellForm").style.display = "none";
            byId("sellResult").innerHTML = "";
            setFieldValue("sellIID", "");
            st.style.display = "none";
            btn.disabled = false;
            void loadRecentSales();
            void loadStock();
            void loadDash();
        }, 800);
    }
    catch (err) {
        const st = byId("sSt");
        st.style.display = "block";
        st.style.background = "var(--red-bg)";
        st.style.color = "var(--red)";
        st.textContent = `❌ ${err.message}`;
        btn.disabled = false;
    }
    finally {
        hide();
    }
    return false;
}
async function loadRecentSales() {
    show();
    try {
        const { data } = await db.from("products").select("*").eq("status", "sold").order("sold_at", { ascending: false }).limit(50);
        const rows = data !== null && data !== void 0 ? data : [];
        byId("sellCount").textContent = String(rows.length);
        const bd = byId("sellBd");
        if (!rows.length) {
            bd.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted)">📭 No sales yet</td></tr>';
            return;
        }
        bd.innerHTML = rows.map((r) => {
            var _a, _b;
            return `
			<tr>
				<td><span class="iid">#${r.iid}</span></td>
				<td>${escapeHtml((_a = r.item_name) !== null && _a !== void 0 ? _a : "")}</td>
				<td>${r.sold_at ? new Date(r.sold_at).toLocaleDateString("en-GB") : "N/A"}</td>
				<td style="font-weight:700;color:var(--green)">${tk(r.sale_total)}</td>
				<td style="font-weight:700;color:${toNum(r.profit) >= 0 ? "var(--green)" : "var(--red)"}">${tk(r.profit)}</td>
				<td class="acts">
					<button class="eb" onclick="editSell('${r.id}',${toNum(r.sale_rate)},${toNum(r.sale_making)},${toNum(r.sale_discount)},${toNum(r.sale_total)},'${escapeJs((_b = r.sale_payment_method) !== null && _b !== void 0 ? _b : "Cash")}',${toNum(r.purchase_total)})">✏️</button>
					<button class="db" onclick="delEntry('products','${r.id}')">🗑️</button>
				</td>
			</tr>
		`;
        }).join("");
    }
    catch (e) {
        console.error(e);
    }
    finally {
        hide();
    }
}
async function loadExpenses() {
    show();
    try {
        const { data } = await db.from("expenses").select("*").order("created_at", { ascending: false }).limit(50);
        const rows = data !== null && data !== void 0 ? data : [];
        byId("expBg").textContent = String(rows.length);
        const bd = byId("expBd");
        if (!rows.length) {
            bd.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted)">📭</td></tr>';
            return;
        }
        bd.innerHTML = rows.map((r) => {
            var _a, _b, _c;
            return `
			<tr>
				<td>${new Date(r.created_at).toLocaleDateString("en-GB")}</td>
				<td>${escapeHtml((_a = r.description) !== null && _a !== void 0 ? _a : "")}</td>
				<td style="font-weight:700;color:var(--red)">${tk(r.amount)}</td>
				<td>${escapeHtml((_b = r.payment_method) !== null && _b !== void 0 ? _b : "-")}</td>
				<td class="acts">
					<button class="eb" onclick="editExp('${r.id}','${escapeJs((_c = r.description) !== null && _c !== void 0 ? _c : "")}',${toNum(r.amount)})">✏️</button>
					<button class="db" onclick="delEntry('expenses','${r.id}')">🗑️</button>
				</td>
			</tr>
		`;
        }).join("");
    }
    catch (e) {
        console.error(e);
    }
    finally {
        hide();
    }
}
async function saveExp(e) {
    e.preventDefault();
    const btn = byId("eBtn");
    btn.disabled = true;
    show();
    try {
        const { error } = await db.from("expenses").insert([{
                description: getFieldValue("eDesc"),
                amount: toNum(getFieldValue("eAmt")),
                payment_method: getFieldValue("ePay"),
                remarks: getFieldValue("eRem") || null,
                created_at: new Date(getFieldValue("eDate")).toISOString()
            }]);
        if (error) {
            throw new Error(error.message);
        }
        const st = byId("eSt");
        st.style.display = "block";
        st.style.background = "var(--green-bg)";
        st.style.color = "var(--green)";
        st.textContent = "✅ Saved!";
        setTimeout(() => {
            byId("expForm").reset();
            setFieldValue("eDate", new Date().toISOString().split("T")[0]);
            st.style.display = "none";
            btn.disabled = false;
            void loadExpenses();
            void loadDash();
        }, 800);
    }
    catch (err) {
        const st = byId("eSt");
        st.style.display = "block";
        st.style.background = "var(--red-bg)";
        st.style.color = "var(--red)";
        st.textContent = `❌ ${err.message}`;
        btn.disabled = false;
    }
    finally {
        hide();
    }
    return false;
}
async function delEntry(tbl, id) {
    if (!checkPw()) {
        return;
    }
    if (!confirm("Delete this entry?")) {
        return;
    }
    show();
    try {
        const { error } = await db.from(tbl).delete().eq("id", id);
        if (error) {
            throw new Error(error.message);
        }
        void loadDash();
        if (tbl === "expenses") {
            void loadExpenses();
        }
        if (tbl === "products") {
            void loadStock();
            void loadRecentSales();
        }
    }
    catch (e) {
        alert(e.message);
    }
    finally {
        hide();
    }
}
async function loadReport() {
    show();
    try {
        const r = getRange(byId("rptP").value);
        const fromTime = new Date(r.from).getTime();
        const toTime = new Date(r.to).getTime();
        const [{ data: allProducts }, { data: expsInRange }] = await Promise.all([
            db.from("products").select("*"),
            db.from("expenses").select("*").gte("created_at", r.from).lte("created_at", r.to)
        ]);
        const allP = allProducts !== null && allProducts !== void 0 ? allProducts : [];
        const allE = expsInRange !== null && expsInRange !== void 0 ? expsInRange : [];
        const inStock = allP.filter((p) => p.status === "in_stock");
        const soldInPeriod = allP.filter((p) => {
            if (p.status !== "sold" || !p.sold_at) {
                return false;
            }
            const soldAt = new Date(p.sold_at).getTime();
            return soldAt >= fromTime && soldAt <= toTime;
        });
        const buyInPeriod = allP.filter((p) => {
            const createdAt = new Date(p.created_at).getTime();
            return createdAt >= fromTime && createdAt <= toTime;
        });
        const stockVal = inStock.reduce((s, i) => s + toNum(i.purchase_total), 0);
        byId("r2StockSum").innerHTML = `
			<div class="rr"><span>Valuation (Inventory Cost)</span><b>${tk(stockVal)}</b></div>
			<div class="rr"><span>Items In Stock</span><b>${inStock.length}</b></div>
		`;
        const sTotal = soldInPeriod.reduce((s, i) => s + toNum(i.sale_total), 0);
        const pTotalSold = soldInPeriod.reduce((s, i) => s + toNum(i.purchase_total), 0);
        const salesProfit = sTotal - pTotalSold;
        const expTotal = allE.reduce((s, i) => s + toNum(i.amount), 0);
        const netIncome = salesProfit - expTotal;
        byId("r2ProfitSum").innerHTML = `
			<div class="rr"><span>Total Sales</span><b style="color:var(--green)">${tk(sTotal)}</b></div>
			<div class="rr"><span>Gross Sales Profit</span><b style="color:var(--green)">${tk(salesProfit)}</b></div>
			<div class="rr"><span>Total Expenses</span><b style="color:var(--red)">${tk(expTotal)}</b></div>
			<div class="rr" style="border-top:2px solid #eee; margin-top:5px; padding-top:5px"><span>Net Income (Period)</span><b style="color:${netIncome >= 0 ? "var(--green)" : "var(--red)"}">${tk(netIncome)}</b></div>
		`;
        const kMap = {};
        inStock.forEach((item) => {
            const key = item.karat || "Unknown";
            if (!kMap[key]) {
                kMap[key] = { w: 0, v: 0 };
            }
            kMap[key].w += toNum(item.weight_gm);
            kMap[key].v += toNum(item.purchase_total);
        });
        byId("r2KaratBd").innerHTML = Object.keys(kMap).sort().map((k) => `
			<tr>
				<td><b>${escapeHtml(k)}</b></td>
				<td>${kMap[k].w.toFixed(3)} g</td>
				<td>${tk(kMap[k].v)}</td>
			</tr>
		`).join("") || '<tr><td colspan="3" style="text-align:center">No stock</td></tr>';
        const ledgerItems = [
            ...buyInPeriod.map((p) => ({
                d: p.created_at,
                desc: `${p.item_name || ""}${p.iid ? ` (#${p.iid})` : ""}`,
                cat: "Purchase",
                deb: toNum(p.purchase_total),
                cred: 0
            })),
            ...soldInPeriod.map((p) => ({
                d: p.sold_at || p.created_at,
                desc: `${p.item_name || ""}${p.iid ? ` (#${p.iid})` : ""}`,
                cat: "Sale",
                deb: 0,
                cred: toNum(p.sale_total)
            })),
            ...allE.map((e) => ({
                d: e.created_at,
                desc: e.description || "",
                cat: "Expense",
                deb: toNum(e.amount),
                cred: 0
            }))
        ].sort((a, b) => new Date(a.d).getTime() - new Date(b.d).getTime());
        const lBd = byId("rdLedger");
        if (!ledgerItems.length) {
            lBd.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted)">📭 No data in period</td></tr>';
        }
        else {
            lBd.innerHTML = ledgerItems.map((item) => `
				<tr>
					<td>${new Date(item.d).toLocaleDateString("en-GB")}</td>
					<td>${escapeHtml(item.desc)}</td>
					<td><span class="tbg ${item.cat === "Sale" ? "t-sold" : item.cat === "Purchase" ? "t-in" : "t-exp"}">${item.cat}</span></td>
					<td style="color:var(--red); font-weight:600">${item.deb > 0 ? tk(item.deb) : "-"}</td>
					<td style="color:var(--green); font-weight:600">${item.cred > 0 ? tk(item.cred) : "-"}</td>
				</tr>
			`).join("");
        }
        const tDebit = buyInPeriod.reduce((s, i) => s + toNum(i.purchase_total), 0) + expTotal;
        const tCredit = sTotal;
        byId("rdTotalDebit").textContent = tk(tDebit);
        byId("rdTotalCredit").textContent = tk(tCredit);
    }
    catch (e) {
        console.error(e);
    }
    finally {
        hide();
    }
}
function autoTrack(el, suffix) {
    if (trackTimer !== undefined) {
        window.clearTimeout(trackTimer);
    }
    trackTimer = window.setTimeout(() => {
        const val = el.value.trim();
        if (val.length >= 1) {
            void trackProduct(suffix);
        }
    }, 250);
}
async function trackProduct(suffix = "") {
    var _a, _b;
    const iidInput = maybeById(`trackIID${suffix}`);
    if (!iidInput) {
        return;
    }
    const searchVal = iidInput.value.trim();
    const res = maybeById(`trackResult${suffix}`);
    if (!res) {
        return;
    }
    if (!searchVal) {
        res.innerHTML = "";
        return;
    }
    try {
        let query = db.from("products").select("*");
        const iid = Number.parseInt(searchVal, 10);
        if (!Number.isNaN(iid) && String(iid) === searchVal) {
            query = query.eq("iid", iid);
        }
        else {
            query = query.ilike("item_name", `%${searchVal}%`).limit(1);
        }
        const { data, error } = await query.single();
        if (error || !data) {
            if (searchVal.length > 3) {
                res.innerHTML = '<div class="product-card" style="border-color:var(--red); padding:10px; font-size:13px">❌ No matching item found</div>';
            }
            return;
        }
        const p = data;
        const isSold = p.status === "sold";
        res.innerHTML = `
			<div class="product-card" style="margin-top:10px; border-color:var(--green); padding:10px">
				<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
					<h3 style="font-size:13px"><span class="iid">#${p.iid}</span> ${escapeHtml((_a = p.item_name) !== null && _a !== void 0 ? _a : "")}</h3>
					<span class="tbg ${isSold ? "t-sold" : "t-in"}" style="font-size:9px">${escapeHtml(String(p.status).toUpperCase())}</span>
				</div>
				<div style="font-size:11px; color:var(--muted); display:flex; gap:10px; border-bottom:1px solid #eee; padding-bottom:5px">
					<span>⚖️ ${toNum(p.weight_gm)}g</span>
					<span>💎 ${escapeHtml((_b = p.karat) !== null && _b !== void 0 ? _b : "-")}</span>
					<span style="color:var(--blue); font-weight:700">💰 ${tk(p.purchase_total)}</span>
				</div>
				${!isSold
            ? `<button onclick="sellThis(${p.iid})" class="sbtn" style="background:var(--green); margin-top:8px; padding:8px; font-size:13px">💰 Sell This Item</button>`
            : `<div style="font-size:11px; margin-top:5px; color:var(--blue); font-weight:600">✅ Sold for ${tk(p.sale_total)} (Profit: ${tk(p.profit)})</div>`}
			</div>
		`;
    }
    catch (err) {
        console.error(err);
    }
}
function doPrint() {
    const d = maybeById("paD");
    const c = maybeById("paC");
    const detail = maybeById("rptDetail");
    if (!d || !c || !detail) {
        return;
    }
    d.textContent = `Full Audit Report: ${new Date().toLocaleString("en-GB")}`;
    c.innerHTML = `<div class="merged-report-print">${detail.innerHTML}</div>`;
    window.print();
}
function doShare() {
    var _a, _b, _c, _d, _e, _f;
    const reportOn = (_b = (_a = maybeById("t-rpt")) === null || _a === void 0 ? void 0 : _a.classList.contains("on")) !== null && _b !== void 0 ? _b : false;
    const periodSelect = reportOn ? maybeById("rptP") : maybeById("dp");
    const pTxt = periodSelect ? periodSelect.options[periodSelect.selectedIndex].text : "";
    const txt = [
        "📊 Goldsmith Report",
        `📅 ${pTxt}`,
        "",
        `💰 Sales: ${((_c = maybeById("dS")) === null || _c === void 0 ? void 0 : _c.textContent) || "N/A"}`,
        `🛒 Purchases: ${((_d = maybeById("dP")) === null || _d === void 0 ? void 0 : _d.textContent) || "N/A"}`,
        `📋 Expenses: ${((_e = maybeById("dE")) === null || _e === void 0 ? void 0 : _e.textContent) || "N/A"}`,
        `📊 Profit: ${((_f = maybeById("dPr")) === null || _f === void 0 ? void 0 : _f.textContent) || "N/A"}`,
        "",
        `— ${new Date().toLocaleDateString("en-GB")}`
    ].join("\n");
    if (navigator.share) {
        void navigator.share({ title: "Report", text: txt }).catch(() => {
            // Silent cancel.
        });
    }
    else {
        void navigator.clipboard.writeText(txt).then(() => alert("Copied!")).catch(() => alert("Copy failed"));
    }
}
async function populateItemDropdown() {
    try {
        const { data } = await db.from("gold_item").select("item_name").order("item_name");
        const sel = maybeById("buyItemMaster");
        if (!sel) {
            return;
        }
        sel.innerHTML = '<option value="">Select Item</option>' + (data !== null && data !== void 0 ? data : []).map((r) => `<option value="${escapeHtml(r.item_name)}">${escapeHtml(r.item_name)}</option>`).join("");
    }
    catch (e) {
        console.error(e);
    }
}
async function loadGoldItems() {
    show();
    try {
        const { data, error } = await db.from("gold_item").select("*").order("itm_id", { ascending: false });
        if (error) {
            throw new Error(error.message);
        }
        const rows = data !== null && data !== void 0 ? data : [];
        byId("itemCount").textContent = String(rows.length);
        const bd = byId("itemBd");
        if (!rows.length) {
            bd.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:30px;color:var(--muted)">📭 No items</td></tr>';
        }
        else {
            bd.innerHTML = rows.map((r) => `
				<tr>
					<td><span class="iid">#${r.itm_id}</span></td>
					<td>${escapeHtml(r.item_name)}</td>
					<td class="acts">
						<button class="eb" onclick="editGoldItem(${r.itm_id}, '${escapeJs(r.item_name)}')">✏️</button>
						<button class="db" onclick="delGoldItem(${r.itm_id})">🗑️</button>
					</td>
				</tr>
			`).join("");
        }
    }
    catch (e) {
        console.error(e);
    }
    finally {
        hide();
    }
}
async function saveGoldItem(e) {
    e.preventDefault();
    const name = getFieldValue("itemName").trim();
    const btn = byId("itemBtn");
    btn.disabled = true;
    show();
    try {
        const { error } = await db.from("gold_item").insert([{ item_name: name }]);
        if (error) {
            throw new Error(error.message);
        }
        const st = byId("itemSt");
        st.style.display = "block";
        st.style.background = "var(--green-bg)";
        st.style.color = "var(--green)";
        st.textContent = "✅ Saved!";
        setTimeout(() => {
            var _a;
            byId("itemForm").reset();
            st.style.display = "none";
            btn.disabled = false;
            void loadGoldItems();
            void populateItemDropdown();
            const rptTab = (_a = document.querySelectorAll(".tab")[3]) !== null && _a !== void 0 ? _a : null;
            go("rpt", rptTab);
        }, 800);
    }
    catch (err) {
        const st = byId("itemSt");
        st.style.display = "block";
        st.style.background = "var(--red-bg)";
        st.style.color = "var(--red)";
        st.textContent = `❌ ${err.message}`;
        btn.disabled = false;
    }
    finally {
        hide();
    }
    return false;
}
async function delGoldItem(id) {
    if (!checkPw()) {
        return;
    }
    if (!confirm("Delete this item?")) {
        return;
    }
    show();
    try {
        const { error } = await db.from("gold_item").delete().eq("itm_id", id);
        if (error) {
            throw new Error(error.message);
        }
        void loadGoldItems();
        void populateItemDropdown();
    }
    catch (e) {
        alert(e.message);
    }
    finally {
        hide();
    }
}
function closeEdit() {
    byId("editModal").classList.remove("on");
    byId("emForm").reset();
}
function editGoldItem(id, name) {
    byId("emTitle").textContent = "💍 Edit Master Item";
    setFieldValue("emTbl", "gold_item");
    setFieldValue("emId", String(id));
    byId("emFields").innerHTML = `<div class="fi"><label>Item Name</label><input type="text" id="ev1" value="${escapeHtml(name)}" required></div>`;
    byId("editModal").classList.add("on");
}
function editExp(id, desc, amt) {
    byId("emTitle").textContent = "📋 Edit Expense";
    setFieldValue("emTbl", "expenses");
    setFieldValue("emId", id);
    byId("emFields").innerHTML = `
		<div class="fi"><label>Description</label><input type="text" id="ev1" value="${escapeHtml(desc)}" required></div>
		<div class="fi"><label>Amount</label><input type="number" id="ev2" value="${toNum(amt)}" step=".01" required></div>
	`;
    byId("editModal").classList.add("on");
}
function editStock(id, name, weight, karat, cost, status) {
    byId("emTitle").textContent = "📦 Edit Stock Item";
    setFieldValue("emTbl", "products");
    setFieldValue("emId", id);
    const defaultKarats = ["22K", "21K", "18K", "S"];
    const allKarats = defaultKarats.includes(karat) ? defaultKarats : [...defaultKarats, karat];
    const karatOptions = allKarats.map((k) => `<option value="${escapeHtml(k)}" ${k === karat ? "selected" : ""}>${escapeHtml(k)}</option>`).join("");
    byId("emFields").innerHTML = `
		<div class="fi"><label>Item Name (Desc)</label><input type="text" id="ev1" value="${escapeHtml(name)}" required></div>
		<div class="fi"><label>Weight (gm)</label><input type="number" id="ev2" value="${toNum(weight)}" step=".001" required></div>
		<div class="fi"><label>Item Type</label><select id="ev3">${karatOptions}</select></div>
		<div class="fi"><label>Total Cost</label><input type="number" id="ev4" value="${toNum(cost)}" step=".01" required></div>
		<div class="fi"><label>Status</label><select id="ev5">
			<option value="in_stock" ${status === "in_stock" ? "selected" : ""}>In Stock</option>
			<option value="sold" ${status === "sold" ? "selected" : ""}>Sold</option>
		</select></div>
	`;
    byId("editModal").classList.add("on");
}
function editSell(id, rate, making, disc, total, pay, pCost) {
    byId("emTitle").textContent = "💰 Edit Sale Details";
    setFieldValue("emTbl", "products_sale");
    setFieldValue("emId", id);
    byId("emFields").innerHTML = `
		<input type="hidden" id="evP" value="${toNum(pCost)}">
		<div class="fi"><label>Sale Rate / vori</label><input type="number" id="ev1" value="${toNum(rate)}" step=".01" required></div>
		<div class="fi"><label>Sale Making Charge</label><input type="number" id="ev2" value="${toNum(making)}" step=".01" required></div>
		<div class="fi"><label>Sale Discount</label><input type="number" id="ev3" value="${toNum(disc)}" step=".01" required></div>
		<div class="fi"><label>Sale Total</label><input type="number" id="ev4" value="${toNum(total)}" step=".01" required></div>
		<div class="fi"><label>Payment Method</label><select id="ev5">
			<option value="Cash" ${pay === "Cash" ? "selected" : ""}>Cash</option>
			<option value="Card" ${pay === "Card" ? "selected" : ""}>Card</option>
			<option value="Mobile Banking" ${pay === "Mobile Banking" ? "selected" : ""}>Mobile Banking</option>
		</select></div>
	`;
    byId("editModal").classList.add("on");
}
async function saveEdit(e) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    e.preventDefault();
    if (!checkPw()) {
        return false;
    }
    const tbl = getFieldValue("emTbl");
    const id = getFieldValue("emId");
    const v1 = (_b = (_a = maybeById("ev1")) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : "";
    const v2 = (_d = (_c = maybeById("ev2")) === null || _c === void 0 ? void 0 : _c.value) !== null && _d !== void 0 ? _d : null;
    const v3 = (_f = (_e = maybeById("ev3")) === null || _e === void 0 ? void 0 : _e.value) !== null && _f !== void 0 ? _f : null;
    const v4 = (_h = (_g = maybeById("ev4")) === null || _g === void 0 ? void 0 : _g.value) !== null && _h !== void 0 ? _h : null;
    const v5 = (_k = (_j = maybeById("ev5")) === null || _j === void 0 ? void 0 : _j.value) !== null && _k !== void 0 ? _k : null;
    show();
    let updateData = {};
    let key = "id";
    let dbTbl = tbl;
    if (tbl === "gold_item") {
        updateData = { item_name: v1 };
        key = "itm_id";
    }
    else if (tbl === "expenses") {
        updateData = { description: v1, amount: toNum(v2) };
    }
    else if (tbl === "products") {
        updateData = {
            item_name: v1,
            weight_gm: toNum(v2),
            karat: v3,
            purchase_total: toNum(v4),
            status: v5
        };
    }
    else if (tbl === "products_sale") {
        const pCost = toNum((_l = maybeById("evP")) === null || _l === void 0 ? void 0 : _l.value);
        const sTotal = toNum(v4);
        updateData = {
            sale_rate: toNum(v1),
            sale_making: toNum(v2),
            sale_discount: toNum(v3),
            sale_total: sTotal,
            profit: sTotal - pCost,
            sale_payment_method: v5
        };
        dbTbl = "products";
    }
    try {
        const { error } = await db.from(dbTbl).update(updateData).eq(key, id);
        if (error) {
            throw new Error(error.message);
        }
        closeEdit();
        void loadDash();
        if (tbl === "gold_item") {
            void loadGoldItems();
            void populateItemDropdown();
        }
        else if (tbl === "expenses") {
            void loadExpenses();
        }
        else if (tbl === "products") {
            void loadStock();
            void loadRecentSales();
        }
        else if (tbl === "products_sale") {
            void loadRecentSales();
            void loadStock();
        }
    }
    catch (err) {
        alert(err.message);
    }
    finally {
        hide();
    }
    return false;
}
// Expose all functions globally for HTML inline onclick handlers
Object.assign(window, {
    go, loadDash, loadStock, loadExpenses, loadReport, calcVori, calcTotalFromVori,
    saveBuy, saveSell, saveExp, saveGoldItem, saveEdit, findProduct,
    calcSell, updSellDisp, autoTrack, trackProduct, doPrint, doShare,
    closeEdit, editGoldItem, editExp, editStock, editSell, delEntry,
    delGoldItem, sellThis, initApp
});
//# sourceMappingURL=stock_calculation.js.map