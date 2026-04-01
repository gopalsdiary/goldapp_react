type StockStatus = "in_stock" | "sold";

interface Product {
	id: string;
	iid: number;
	item_name: string;
	weight_gm: number | null;
	karat: string | null;
	purchase_rate: number | null;
	purchase_wastage: number | null;
	purchase_making: number | null;
	purchase_total: number | null;
	payment_method: string | null;
	remarks: string | null;
	created_at: string;
	status: StockStatus | string;
	sale_rate: number | null;
	sale_making: number | null;
	sale_discount: number | null;
	sale_total: number | null;
	sold_at: string | null;
	sale_payment_method: string | null;
	profit: number | null;
}

interface Expense {
	id: string;
	description: string;
	amount: number | null;
	payment_method: string | null;
	remarks: string | null;
	created_at: string;
}

interface GoldItem {
	itm_id: number;
	item_name: string;
}

interface DateRange {
	from: string;
	to: string;
}

interface SupabaseResult<T> {
	data: T | null;
	error: { message: string } | null;
}

interface WindowWithSupabase extends Window {
	kbSupabaseClient?: any;
}

// --- Ensure Supabase is initialized before proceeding ---
async function ensureSupabaseReady(): Promise<any> {
	let retries = 0;
	while (!(window as WindowWithSupabase).kbSupabaseClient && retries < 50) {
		await new Promise(r => setTimeout(r, 100));
		retries++;
	}
	return (window as WindowWithSupabase).kbSupabaseClient;
}

let db: any = null;

// Initialize database connection
ensureSupabaseReady().then(client => {
	db = client;
	console.log('✓ Supabase client initialized');
}).catch(err => {
	console.error('✗ Failed to initialize Supabase:', err);
});

let currentSellProduct: Product | null = null;
let trackTimer: number | undefined;

const ADMIN_PW = "11223";
const VORI_IN_GRAM = 11.664;

function byId<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id);
	if (!el) {
		throw new Error(`Element not found: #${id}`);
	}
	return el as T;
}

function maybeById<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}

function getFieldValue(id: string): string {
	const el = byId<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
	return el.value;
}

function setFieldValue(id: string, value: string): void {
	const el = byId<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
	el.value = value;
}

function toNum(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function tk(n: number | string | null | undefined): string {
	return toNum(n).toLocaleString("en-IN", {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2
	});
}

function escapeJs(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'")
		.replace(/\r/g, "")
		.replace(/\n/g, " ");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function show(): void {
	maybeById<HTMLElement>("lov")?.classList.add("show");
}

function hide(): void {
	maybeById<HTMLElement>("lov")?.classList.remove("show");
}

function getRange(period: string): DateRange {
	const now = new Date();
	let from: Date;
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

async function initApp(): Promise<void> {
	// CRITICAL: Ensure Supabase is ready and establish db connection
	const client = await ensureSupabaseReady();
	if (client) {
		db = client;
		console.log('✓ Database connection established in initApp');
	} else {
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
} else {
	window.addEventListener("load", () => initApp().catch(e => console.error("Init failed:", e)));
}

function go(id: string, el?: Element | null): void {
	document.querySelectorAll<HTMLElement>(".tc").forEach((t) => t.classList.remove("on"));
	document.querySelectorAll<HTMLElement>(".tab").forEach((b) => b.classList.remove("on"));

	maybeById<HTMLElement>(`t-${id}`)?.classList.add("on");
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

function calcVori(): void {
	const weight = toNum(getFieldValue("bW"));
	const total = toNum(getFieldValue("bTotal"));
	if (weight > 0) {
		const voriPrice = (total / weight) * VORI_IN_GRAM;
		setFieldValue("bVori", String(Math.round(voriPrice)));
	}
}

function calcTotalFromVori(): void {
	const weight = toNum(getFieldValue("bW"));
	const voriPrice = toNum(getFieldValue("bVori"));
	if (weight > 0) {
		const total = (voriPrice / VORI_IN_GRAM) * weight;
		setFieldValue("bTotal", String(Math.round(total)));
	}
}

function sellThis(iid: number): void {
	setFieldValue("sellIID", String(iid));
	document.querySelectorAll<HTMLElement>(".tc").forEach((t) => t.classList.remove("on"));
	document.querySelectorAll<HTMLElement>(".tab").forEach((b) => b.classList.remove("on"));
	maybeById<HTMLElement>("t-sell")?.classList.add("on");
	void findProduct();
}

async function loadDash(): Promise<void> {
	show();
	try {
		const period = byId<HTMLSelectElement>("dp").value;
		const r = getRange(period);

		const [pRes, eRes] = await Promise.all([
			db.from("products").select("*").gte("created_at", r.from).lte("created_at", r.to).order("created_at", { ascending: false }),
			db.from("expenses").select("*").gte("created_at", r.from).lte("created_at", r.to).order("created_at", { ascending: false })
		]) as [SupabaseResult<Product[]>, SupabaseResult<Expense[]>];

		const prods = pRes.data ?? [];
		const exps = eRes.data ?? [];
		const sold = prods.filter((p) => p.status === "sold");

		const totalSales = sold.reduce((s, p) => s + toNum(p.sale_total), 0);
		const totalPurchase = prods.reduce((s, p) => s + toNum(p.purchase_total), 0);
		const totalExpense = exps.reduce((s, e) => s + toNum(e.amount), 0);
		const profit = totalSales - totalPurchase - totalExpense;

		byId<HTMLElement>("dS").textContent = tk(totalSales);
		byId<HTMLElement>("dSc").textContent = `${sold.length} items sold`;
		byId<HTMLElement>("dP").textContent = tk(totalPurchase);
		byId<HTMLElement>("dPc").textContent = `${prods.length} items`;
		byId<HTMLElement>("dE").textContent = tk(totalExpense);
		byId<HTMLElement>("dEc").textContent = `${exps.length} items`;
		byId<HTMLElement>("dPr").textContent = tk(profit);
		byId<HTMLElement>("dPr").style.color = profit >= 0 ? "var(--green)" : "var(--red)";

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

		byId<HTMLElement>("dRc").textContent = String(all.length);
		const bd = byId<HTMLElement>("dRb");
		bd.innerHTML = all.map((row) => `
			<tr>
				<td>${new Date(row.d).toLocaleDateString("en-GB")}</td>
				<td>${row.iid !== "-" ? `<span class="iid">#${row.iid}</span>` : "-"}</td>
				<td><span class="tbg ${row.type === "Sold" ? "t-sold" : row.type === "Stock" ? "t-in" : "t-exp"}">${row.type}</span></td>
				<td>${escapeHtml(String(row.item ?? ""))}</td>
				<td style="font-weight:700">${tk(row.amt as number)}</td>
			</tr>
		`).join("");
	} catch (e) {
		console.error(e);
	} finally {
		hide();
	}
}

function checkPw(): boolean {
	const p = prompt("🔐 Enter Admin Password:");
	if (p === ADMIN_PW) {
		return true;
	}
	if (p !== null) {
		alert("❌ Incorrect password!");
	}
	return false;
}

async function saveBuy(e: Event): Promise<boolean> {
	e.preventDefault();
	const btn = byId<HTMLButtonElement>("bBtn");
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

		const { data, error } = await db.from("products").insert([payload]).select() as SupabaseResult<Product[]>;
		if (error) {
			throw new Error(error.message);
		}

		const saved = (data ?? [])[0];
		const st = byId<HTMLElement>("bSt");
		st.style.display = "block";
		st.style.background = "var(--green-bg)";
		st.style.color = "var(--green)";
		st.textContent = `✅ Saved! IID: #${saved?.iid ?? "N/A"}`;

		setTimeout(() => {
			const addAnother = confirm(`✅ IID #${saved?.iid ?? "N/A"} saved! Add another?`);
			if (addAnother) {
				byId<HTMLFormElement>("buyForm").reset();
				setFieldValue("bDate", new Date().toISOString().split("T")[0]);
				st.style.display = "none";
			} else {
				const stockTab = document.querySelectorAll<HTMLElement>(".tab")[1] ?? null;
				go("stock", stockTab);
			}
			btn.disabled = false;
		}, 800);
	} catch (err) {
		const st = byId<HTMLElement>("bSt");
		st.style.display = "block";
		st.style.background = "var(--red-bg)";
		st.style.color = "var(--red)";
		st.textContent = `❌ ${(err as Error).message}`;
		btn.disabled = false;
	} finally {
		hide();
	}

	return false;
}

async function loadStock(): Promise<void> {
	show();
	try {
		const filter = byId<HTMLSelectElement>("stockFilter").value;
		let q = db.from("products").select("*").order("created_at", { ascending: false });
		if (filter !== "all") {
			q = q.eq("status", filter);
		}

		const { data } = await q as SupabaseResult<Product[]>;
		const rows = data ?? [];
		byId<HTMLElement>("stockBg").textContent = String(rows.length);

		const bd = byId<HTMLElement>("stockBd");
		if (!rows.length) {
			bd.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted)">📭 No data</td></tr>';
			return;
		}

		bd.innerHTML = rows.map((r) => `
			<tr>
				<td><span class="iid">#${r.iid}</span></td>
				<td>${escapeHtml(r.item_name ?? "")}</td>
				<td>${toNum(r.weight_gm)}g</td>
				<td>${escapeHtml(r.karat ?? "-")}</td>
				<td>${tk(r.purchase_total)}</td>
				<td><span class="tbg ${r.status === "sold" ? "t-sold" : "t-in"}">${r.status === "sold" ? "Sold" : "In Stock"}</span></td>
				<td class="acts">
					<button class="eb" onclick="editStock('${r.id}','${escapeJs(r.item_name ?? "")}',${toNum(r.weight_gm)},'${escapeJs(r.karat ?? "")}',${toNum(r.purchase_total)},'${escapeJs(r.status)}')">✏️</button>
					<button class="db" onclick="delEntry('products','${r.id}')">🗑️</button>
				</td>
			</tr>
		`).join("");
	} catch (e) {
		console.error(e);
	} finally {
		hide();
	}
}

async function findProduct(): Promise<void> {
	const iid = Number.parseInt(getFieldValue("sellIID"), 10);
	if (!Number.isInteger(iid)) {
		alert("Enter a valid IID");
		return;
	}

	show();
	try {
		const { data, error } = await db.from("products").select("*").eq("iid", iid).single() as SupabaseResult<Product>;
		if (error || !data) {
			throw new Error(error?.message || "Product not found!");
		}

		if (data.status === "sold") {
			byId<HTMLElement>("sellResult").innerHTML = `
				<div class="product-card" style="border-color:var(--orange)">
					<h3>⚠️ Already Sold!</h3>
					<p>IID #${data.iid} (${escapeHtml(data.item_name ?? "")}) was sold on ${data.sold_at ? new Date(data.sold_at).toLocaleDateString("en-GB") : "N/A"} for ${tk(data.sale_total)}</p>
				</div>
			`;
			byId<HTMLElement>("sellForm").style.display = "none";
			return;
		}

		currentSellProduct = data;
		byId<HTMLElement>("sellResult").innerHTML = `
			<div class="product-card">
				<h3><span class="iid">#${data.iid}</span> ${escapeHtml(data.item_name ?? "")}</h3>
				<div class="row"><span>Weight</span><span>${toNum(data.weight_gm)}g</span></div>
				<div class="row"><span>Item Type</span><span>${escapeHtml(data.karat ?? "-")}</span></div>
				<div class="row"><span>Purchase Cost</span><span style="font-weight:700">${tk(data.purchase_total)}</span></div>
			</div>
		`;
		byId<HTMLElement>("sellForm").style.display = "block";
	} catch (err) {
		byId<HTMLElement>("sellResult").innerHTML = `<div class="product-card" style="border-color:var(--red)"><h3>❌ ${(err as Error).message}</h3></div>`;
		byId<HTMLElement>("sellForm").style.display = "none";
	} finally {
		hide();
	}
}

function calcSell(): void {
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

function updSellDisp(): void {
	// Reserved for future UI-only breakdown display.
}

async function saveSell(e: Event): Promise<boolean> {
	e.preventDefault();
	if (!currentSellProduct) {
		return false;
	}

	const btn = byId<HTMLButtonElement>("sBtn");
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
		}).eq("id", currentSellProduct.id) as SupabaseResult<null>;

		if (error) {
			throw new Error(error.message);
		}

		const st = byId<HTMLElement>("sSt");
		st.style.display = "block";
		st.style.background = "var(--green-bg)";
		st.style.color = "var(--green)";
		st.textContent = `✅ Sold! Profit: ${tk(profit)}`;

		setTimeout(() => {
			alert(`✅ IID #${currentSellProduct?.iid ?? "N/A"} sold!\nProfit: ${tk(profit)}`);
			currentSellProduct = null;
			byId<HTMLFormElement>("sellForm").reset();
			byId<HTMLElement>("sellForm").style.display = "none";
			byId<HTMLElement>("sellResult").innerHTML = "";
			setFieldValue("sellIID", "");
			st.style.display = "none";
			btn.disabled = false;
			void loadRecentSales();
			void loadStock();
			void loadDash();
		}, 800);
	} catch (err) {
		const st = byId<HTMLElement>("sSt");
		st.style.display = "block";
		st.style.background = "var(--red-bg)";
		st.style.color = "var(--red)";
		st.textContent = `❌ ${(err as Error).message}`;
		btn.disabled = false;
	} finally {
		hide();
	}

	return false;
}

async function loadRecentSales(): Promise<void> {
	show();
	try {
		const { data } = await db.from("products").select("*").eq("status", "sold").order("sold_at", { ascending: false }).limit(50) as SupabaseResult<Product[]>;
		const rows = data ?? [];
		byId<HTMLElement>("sellCount").textContent = String(rows.length);

		const bd = byId<HTMLElement>("sellBd");
		if (!rows.length) {
			bd.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted)">📭 No sales yet</td></tr>';
			return;
		}

		bd.innerHTML = rows.map((r) => `
			<tr>
				<td><span class="iid">#${r.iid}</span></td>
				<td>${escapeHtml(r.item_name ?? "")}</td>
				<td>${r.sold_at ? new Date(r.sold_at).toLocaleDateString("en-GB") : "N/A"}</td>
				<td style="font-weight:700;color:var(--green)">${tk(r.sale_total)}</td>
				<td style="font-weight:700;color:${toNum(r.profit) >= 0 ? "var(--green)" : "var(--red)"}">${tk(r.profit)}</td>
				<td class="acts">
					<button class="eb" onclick="editSell('${r.id}',${toNum(r.sale_rate)},${toNum(r.sale_making)},${toNum(r.sale_discount)},${toNum(r.sale_total)},'${escapeJs(r.sale_payment_method ?? "Cash")}',${toNum(r.purchase_total)})">✏️</button>
					<button class="db" onclick="delEntry('products','${r.id}')">🗑️</button>
				</td>
			</tr>
		`).join("");
	} catch (e) {
		console.error(e);
	} finally {
		hide();
	}
}

async function loadExpenses(): Promise<void> {
	show();
	try {
		const { data } = await db.from("expenses").select("*").order("created_at", { ascending: false }).limit(50) as SupabaseResult<Expense[]>;
		const rows = data ?? [];
		byId<HTMLElement>("expBg").textContent = String(rows.length);

		const bd = byId<HTMLElement>("expBd");
		if (!rows.length) {
			bd.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted)">📭</td></tr>';
			return;
		}

		bd.innerHTML = rows.map((r) => `
			<tr>
				<td>${new Date(r.created_at).toLocaleDateString("en-GB")}</td>
				<td>${escapeHtml(r.description ?? "")}</td>
				<td style="font-weight:700;color:var(--red)">${tk(r.amount)}</td>
				<td>${escapeHtml(r.payment_method ?? "-")}</td>
				<td class="acts">
					<button class="eb" onclick="editExp('${r.id}','${escapeJs(r.description ?? "")}',${toNum(r.amount)})">✏️</button>
					<button class="db" onclick="delEntry('expenses','${r.id}')">🗑️</button>
				</td>
			</tr>
		`).join("");
	} catch (e) {
		console.error(e);
	} finally {
		hide();
	}
}

async function saveExp(e: Event): Promise<boolean> {
	e.preventDefault();
	const btn = byId<HTMLButtonElement>("eBtn");
	btn.disabled = true;
	show();

	try {
		const { error } = await db.from("expenses").insert([{
			description: getFieldValue("eDesc"),
			amount: toNum(getFieldValue("eAmt")),
			payment_method: getFieldValue("ePay"),
			remarks: getFieldValue("eRem") || null,
			created_at: new Date(getFieldValue("eDate")).toISOString()
		}]) as SupabaseResult<null>;

		if (error) {
			throw new Error(error.message);
		}

		const st = byId<HTMLElement>("eSt");
		st.style.display = "block";
		st.style.background = "var(--green-bg)";
		st.style.color = "var(--green)";
		st.textContent = "✅ Saved!";

		setTimeout(() => {
			byId<HTMLFormElement>("expForm").reset();
			setFieldValue("eDate", new Date().toISOString().split("T")[0]);
			st.style.display = "none";
			btn.disabled = false;
			void loadExpenses();
			void loadDash();
		}, 800);
	} catch (err) {
		const st = byId<HTMLElement>("eSt");
		st.style.display = "block";
		st.style.background = "var(--red-bg)";
		st.style.color = "var(--red)";
		st.textContent = `❌ ${(err as Error).message}`;
		btn.disabled = false;
	} finally {
		hide();
	}

	return false;
}

async function delEntry(tbl: "products" | "expenses", id: string): Promise<void> {
	if (!checkPw()) {
		return;
	}
	if (!confirm("Delete this entry?")) {
		return;
	}

	show();
	try {
		const { error } = await db.from(tbl).delete().eq("id", id) as SupabaseResult<null>;
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
	} catch (e) {
		alert((e as Error).message);
	} finally {
		hide();
	}
}

async function loadReport(): Promise<void> {
	show();
	try {
		const r = getRange(byId<HTMLSelectElement>("rptP").value);
		const fromTime = new Date(r.from).getTime();
		const toTime = new Date(r.to).getTime();

		const [{ data: allProducts }, { data: expsInRange }] = await Promise.all([
			db.from("products").select("*"),
			db.from("expenses").select("*").gte("created_at", r.from).lte("created_at", r.to)
		]) as [SupabaseResult<Product[]>, SupabaseResult<Expense[]>];

		const allP = allProducts ?? [];
		const allE = expsInRange ?? [];

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
		byId<HTMLElement>("r2StockSum").innerHTML = `
			<div class="rr"><span>Valuation (Inventory Cost)</span><b>${tk(stockVal)}</b></div>
			<div class="rr"><span>Items In Stock</span><b>${inStock.length}</b></div>
		`;

		const sTotal = soldInPeriod.reduce((s, i) => s + toNum(i.sale_total), 0);
		const pTotalSold = soldInPeriod.reduce((s, i) => s + toNum(i.purchase_total), 0);
		const salesProfit = sTotal - pTotalSold;
		const expTotal = allE.reduce((s, i) => s + toNum(i.amount), 0);
		const netIncome = salesProfit - expTotal;

		byId<HTMLElement>("r2ProfitSum").innerHTML = `
			<div class="rr"><span>Total Sales</span><b style="color:var(--green)">${tk(sTotal)}</b></div>
			<div class="rr"><span>Gross Sales Profit</span><b style="color:var(--green)">${tk(salesProfit)}</b></div>
			<div class="rr"><span>Total Expenses</span><b style="color:var(--red)">${tk(expTotal)}</b></div>
			<div class="rr" style="border-top:2px solid #eee; margin-top:5px; padding-top:5px"><span>Net Income (Period)</span><b style="color:${netIncome >= 0 ? "var(--green)" : "var(--red)"}">${tk(netIncome)}</b></div>
		`;

		const kMap: Record<string, { w: number; v: number }> = {};
		inStock.forEach((item) => {
			const key = item.karat || "Unknown";
			if (!kMap[key]) {
				kMap[key] = { w: 0, v: 0 };
			}
			kMap[key].w += toNum(item.weight_gm);
			kMap[key].v += toNum(item.purchase_total);
		});

		byId<HTMLElement>("r2KaratBd").innerHTML = Object.keys(kMap).sort().map((k) => `
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

		const lBd = byId<HTMLElement>("rdLedger");
		if (!ledgerItems.length) {
			lBd.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted)">📭 No data in period</td></tr>';
		} else {
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
		byId<HTMLElement>("rdTotalDebit").textContent = tk(tDebit);
		byId<HTMLElement>("rdTotalCredit").textContent = tk(tCredit);
	} catch (e) {
		console.error(e);
	} finally {
		hide();
	}
}

function autoTrack(el: HTMLInputElement, suffix: string): void {
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

async function trackProduct(suffix = ""): Promise<void> {
	const iidInput = maybeById<HTMLInputElement>(`trackIID${suffix}`);
	if (!iidInput) {
		return;
	}

	const searchVal = iidInput.value.trim();
	const res = maybeById<HTMLElement>(`trackResult${suffix}`);
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
		} else {
			query = query.ilike("item_name", `%${searchVal}%`).limit(1);
		}

		const { data, error } = await query.single() as SupabaseResult<Product>;
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
					<h3 style="font-size:13px"><span class="iid">#${p.iid}</span> ${escapeHtml(p.item_name ?? "")}</h3>
					<span class="tbg ${isSold ? "t-sold" : "t-in"}" style="font-size:9px">${escapeHtml(String(p.status).toUpperCase())}</span>
				</div>
				<div style="font-size:11px; color:var(--muted); display:flex; gap:10px; border-bottom:1px solid #eee; padding-bottom:5px">
					<span>⚖️ ${toNum(p.weight_gm)}g</span>
					<span>💎 ${escapeHtml(p.karat ?? "-")}</span>
					<span style="color:var(--blue); font-weight:700">💰 ${tk(p.purchase_total)}</span>
				</div>
				${!isSold
					? `<button onclick="sellThis(${p.iid})" class="sbtn" style="background:var(--green); margin-top:8px; padding:8px; font-size:13px">💰 Sell This Item</button>`
					: `<div style="font-size:11px; margin-top:5px; color:var(--blue); font-weight:600">✅ Sold for ${tk(p.sale_total)} (Profit: ${tk(p.profit)})</div>`}
			</div>
		`;
	} catch (err) {
		console.error(err);
	}
}

function doPrint(): void {
	const d = maybeById<HTMLElement>("paD");
	const c = maybeById<HTMLElement>("paC");
	const detail = maybeById<HTMLElement>("rptDetail");
	if (!d || !c || !detail) {
		return;
	}

	d.textContent = `Full Audit Report: ${new Date().toLocaleString("en-GB")}`;
	c.innerHTML = `<div class="merged-report-print">${detail.innerHTML}</div>`;
	window.print();
}

function doShare(): void {
	const reportOn = maybeById<HTMLElement>("t-rpt")?.classList.contains("on") ?? false;
	const periodSelect = reportOn ? maybeById<HTMLSelectElement>("rptP") : maybeById<HTMLSelectElement>("dp");
	const pTxt = periodSelect ? periodSelect.options[periodSelect.selectedIndex].text : "";

	const txt = [
		"📊 Goldsmith Report",
		`📅 ${pTxt}`,
		"",
		`💰 Sales: ${maybeById<HTMLElement>("dS")?.textContent || "N/A"}`,
		`🛒 Purchases: ${maybeById<HTMLElement>("dP")?.textContent || "N/A"}`,
		`📋 Expenses: ${maybeById<HTMLElement>("dE")?.textContent || "N/A"}`,
		`📊 Profit: ${maybeById<HTMLElement>("dPr")?.textContent || "N/A"}`,
		"",
		`— ${new Date().toLocaleDateString("en-GB")}`
	].join("\n");

	if (navigator.share) {
		void navigator.share({ title: "Report", text: txt }).catch(() => {
			// Silent cancel.
		});
	} else {
		void navigator.clipboard.writeText(txt).then(() => alert("Copied!")).catch(() => alert("Copy failed"));
	}
}

async function populateItemDropdown(): Promise<void> {
	try {
		const { data } = await db.from("gold_item").select("item_name").order("item_name") as SupabaseResult<Pick<GoldItem, "item_name">[]>;
		const sel = maybeById<HTMLSelectElement>("buyItemMaster");
		if (!sel) {
			return;
		}

		sel.innerHTML = '<option value="">Select Item</option>' + (data ?? []).map((r) => `<option value="${escapeHtml(r.item_name)}">${escapeHtml(r.item_name)}</option>`).join("");
	} catch (e) {
		console.error(e);
	}
}

async function loadGoldItems(): Promise<void> {
	show();
	try {
		const { data, error } = await db.from("gold_item").select("*").order("itm_id", { ascending: false }) as SupabaseResult<GoldItem[]>;
		if (error) {
			throw new Error(error.message);
		}

		const rows = data ?? [];
		byId<HTMLElement>("itemCount").textContent = String(rows.length);
		const bd = byId<HTMLElement>("itemBd");

		if (!rows.length) {
			bd.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:30px;color:var(--muted)">📭 No items</td></tr>';
		} else {
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
	} catch (e) {
		console.error(e);
	} finally {
		hide();
	}
}

async function saveGoldItem(e: Event): Promise<boolean> {
	e.preventDefault();
	const name = getFieldValue("itemName").trim();
	const btn = byId<HTMLButtonElement>("itemBtn");
	btn.disabled = true;
	show();

	try {
		const { error } = await db.from("gold_item").insert([{ item_name: name }]) as SupabaseResult<null>;
		if (error) {
			throw new Error(error.message);
		}

		const st = byId<HTMLElement>("itemSt");
		st.style.display = "block";
		st.style.background = "var(--green-bg)";
		st.style.color = "var(--green)";
		st.textContent = "✅ Saved!";

		setTimeout(() => {
			byId<HTMLFormElement>("itemForm").reset();
			st.style.display = "none";
			btn.disabled = false;
			void loadGoldItems();
			void populateItemDropdown();
			const rptTab = document.querySelectorAll<HTMLElement>(".tab")[3] ?? null;
			go("rpt", rptTab);
		}, 800);
	} catch (err) {
		const st = byId<HTMLElement>("itemSt");
		st.style.display = "block";
		st.style.background = "var(--red-bg)";
		st.style.color = "var(--red)";
		st.textContent = `❌ ${(err as Error).message}`;
		btn.disabled = false;
	} finally {
		hide();
	}

	return false;
}

async function delGoldItem(id: number): Promise<void> {
	if (!checkPw()) {
		return;
	}
	if (!confirm("Delete this item?")) {
		return;
	}

	show();
	try {
		const { error } = await db.from("gold_item").delete().eq("itm_id", id) as SupabaseResult<null>;
		if (error) {
			throw new Error(error.message);
		}

		void loadGoldItems();
		void populateItemDropdown();
	} catch (e) {
		alert((e as Error).message);
	} finally {
		hide();
	}
}

function closeEdit(): void {
	byId<HTMLElement>("editModal").classList.remove("on");
	byId<HTMLFormElement>("emForm").reset();
}

function editGoldItem(id: number, name: string): void {
	byId<HTMLElement>("emTitle").textContent = "💍 Edit Master Item";
	setFieldValue("emTbl", "gold_item");
	setFieldValue("emId", String(id));
	byId<HTMLElement>("emFields").innerHTML = `<div class="fi"><label>Item Name</label><input type="text" id="ev1" value="${escapeHtml(name)}" required></div>`;
	byId<HTMLElement>("editModal").classList.add("on");
}

function editExp(id: string, desc: string, amt: number): void {
	byId<HTMLElement>("emTitle").textContent = "📋 Edit Expense";
	setFieldValue("emTbl", "expenses");
	setFieldValue("emId", id);
	byId<HTMLElement>("emFields").innerHTML = `
		<div class="fi"><label>Description</label><input type="text" id="ev1" value="${escapeHtml(desc)}" required></div>
		<div class="fi"><label>Amount</label><input type="number" id="ev2" value="${toNum(amt)}" step=".01" required></div>
	`;
	byId<HTMLElement>("editModal").classList.add("on");
}

function editStock(id: string, name: string, weight: number, karat: string, cost: number, status: string): void {
	byId<HTMLElement>("emTitle").textContent = "📦 Edit Stock Item";
	setFieldValue("emTbl", "products");
	setFieldValue("emId", id);

	const defaultKarats = ["22K", "21K", "18K", "S"];
	const allKarats = defaultKarats.includes(karat) ? defaultKarats : [...defaultKarats, karat];
	const karatOptions = allKarats.map((k) => `<option value="${escapeHtml(k)}" ${k === karat ? "selected" : ""}>${escapeHtml(k)}</option>`).join("");

	byId<HTMLElement>("emFields").innerHTML = `
		<div class="fi"><label>Item Name (Desc)</label><input type="text" id="ev1" value="${escapeHtml(name)}" required></div>
		<div class="fi"><label>Weight (gm)</label><input type="number" id="ev2" value="${toNum(weight)}" step=".001" required></div>
		<div class="fi"><label>Item Type</label><select id="ev3">${karatOptions}</select></div>
		<div class="fi"><label>Total Cost</label><input type="number" id="ev4" value="${toNum(cost)}" step=".01" required></div>
		<div class="fi"><label>Status</label><select id="ev5">
			<option value="in_stock" ${status === "in_stock" ? "selected" : ""}>In Stock</option>
			<option value="sold" ${status === "sold" ? "selected" : ""}>Sold</option>
		</select></div>
	`;
	byId<HTMLElement>("editModal").classList.add("on");
}

function editSell(id: string, rate: number, making: number, disc: number, total: number, pay: string, pCost: number): void {
	byId<HTMLElement>("emTitle").textContent = "💰 Edit Sale Details";
	setFieldValue("emTbl", "products_sale");
	setFieldValue("emId", id);
	byId<HTMLElement>("emFields").innerHTML = `
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
	byId<HTMLElement>("editModal").classList.add("on");
}

async function saveEdit(e: Event): Promise<boolean> {
	e.preventDefault();
	if (!checkPw()) {
		return false;
	}

	const tbl = getFieldValue("emTbl");
	const id = getFieldValue("emId");

	const v1 = maybeById<HTMLInputElement>("ev1")?.value ?? "";
	const v2 = maybeById<HTMLInputElement>("ev2")?.value ?? null;
	const v3 = maybeById<HTMLInputElement | HTMLSelectElement>("ev3")?.value ?? null;
	const v4 = maybeById<HTMLInputElement>("ev4")?.value ?? null;
	const v5 = maybeById<HTMLInputElement | HTMLSelectElement>("ev5")?.value ?? null;

	show();

	let updateData: Record<string, unknown> = {};
	let key = "id";
	let dbTbl = tbl;

	if (tbl === "gold_item") {
		updateData = { item_name: v1 };
		key = "itm_id";
	} else if (tbl === "expenses") {
		updateData = { description: v1, amount: toNum(v2) };
	} else if (tbl === "products") {
		updateData = {
			item_name: v1,
			weight_gm: toNum(v2),
			karat: v3,
			purchase_total: toNum(v4),
			status: v5
		};
	} else if (tbl === "products_sale") {
		const pCost = toNum(maybeById<HTMLInputElement>("evP")?.value);
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
		const { error } = await db.from(dbTbl).update(updateData).eq(key, id) as SupabaseResult<null>;
		if (error) {
			throw new Error(error.message);
		}

		closeEdit();
		void loadDash();

		if (tbl === "gold_item") {
			void loadGoldItems();
			void populateItemDropdown();
		} else if (tbl === "expenses") {
			void loadExpenses();
		} else if (tbl === "products") {
			void loadStock();
			void loadRecentSales();
		} else if (tbl === "products_sale") {
			void loadRecentSales();
			void loadStock();
		}
	} catch (err) {
		alert((err as Error).message);
	} finally {
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
