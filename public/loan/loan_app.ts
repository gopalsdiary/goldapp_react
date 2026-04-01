// loan_app.ts - Unified Loan Management System
// Complete TypeScript implementation with improved architecture and maintainability

/** Configuration and Constants */
const CONFIG = {
    // Storage & Database
    BUCKET: 'accounting_db_bucket',
    MAX_IMAGE_SIZE: 199 * 1024,
    
    // Security
    ADMIN_PASSWORD: '11223',
    SUPABASE_RETRY_ATTEMPTS: 50,
    SUPABASE_RETRY_DELAY_MS: 100,
    
    // Loan Calculations
    PDF_FONT_STACK: "'Inter', 'Noto Sans Bengali', sans-serif",
    LOG_ENTRY_PATTERN: /\[\[RLOG:([\d.]+):([\d.]+):(F|T)\]\]/,
    PAYMENT_SPLIT_THRESHOLD: 0.01,
    
    // UI Constants
    DEBOUNCE_DELAY_MS: 800,
    DAYS_FOR_ALERT: 7,
    INTEREST_WARNING_MULTIPLIER: 1,
    
    // Locale & Formatting
    DATE_LOCALE: 'en-GB',
    CURRENCY_LOCALE: 'en-IN',
    CURRENCY_MAX_FRACTION_DIGITS: 0,
    DAYS_IN_MONTH: 30
} as const;

/** Database connection instance */
let db: any = null;

/** Initialize database connection */
async function ensureSupabaseReady(): Promise<any> {
    let retries = 0;
    const maxRetries = CONFIG.SUPABASE_RETRY_ATTEMPTS;
    const delayMs = CONFIG.SUPABASE_RETRY_DELAY_MS;
    
    while (!window.kbSupabaseClient && retries < maxRetries) {
        await new Promise(r => setTimeout(r, delayMs));
        retries++;
    }
    return window.kbSupabaseClient;
}

// Initialize database connection
ensureSupabaseReady().then(client => {
    db = client;
    console.log('✓ Supabase client initialized');
}).catch(err => {
    console.error('✗ Failed to initialize Supabase:', err);
});

/** Type Definitions */

/** Loan Status enumeration */
type LoanStatus = 'active' | 'closed';

/** Loan record from database */
interface Loan {
    id: string;
    iid: number;
    name: string;
    mobile: string;
    nid_number: string | null;
    loan_date: string;
    loan_amount: number;
    interest_rate: number;
    loan_months: number;
    deposit_item: string | null;
    photo_url: string | null;
    nid_photo_url: string | null;
    remarks: string | null;
    status: LoanStatus;
    closed_at: string | null;
    created_at: string;
}

/** Transaction record from database */
interface Transaction {
    id: string;
    loan_id: string;
    txn_date: string;
    amount: number;
    remarks: string | null;
    txn_type?: 'payment' | 'adjustment';
    created_at: string;
}

/** Rate change history entry */
interface RateHistory {
    date: string;
    old: number;
    new: number;
    type: 'F' | 'T';
}

/** Loan balance calculation result */
interface LoanBalance {
    principal: number;
    lastDate: string;
    interest_owed: number;
    currentDue: number;
    totalPaid: number;
    totalInterest: number;
    currentInterest: number;
    preClosureDue: number;
    pending_interest: number;
    history: HistoryEntry[];
}

/** History entry for statement */
interface HistoryEntry {
    date: string;
    desc: string;
    debit: number;
    credit: number;
    balance: number;
    isInterest?: boolean;
    isLog?: boolean;
    isTxn?: boolean;
    isClosure?: boolean;
    txId?: string;
}

/** Application state */
const AppState = {
    lastView: 'dash',
    activeLoanId: null as string | null
};

/** Dashboard statistics summary */
interface DashboardStats {
    active: number;
    disbursed: number;
    outAsol: number;
    outMunafa: number;
    collAsol: number;
    collMunafa: number;
    closed: number;
    badAmt: number;
    badCount: number;
}

/** Global UI Hooking - Export functions to window */
Object.assign(window, {
    go, goBack, showAllLoans, saveLoan, previewImg, searchLoans,
    loadAllLoans, openAccount, editFullInfo, saveEditForm,
    openPayModal, updatePayModalInfo, closePayModal, savePayment,
    calcPaySplit, syncPayTotal, closeConfModal, closeLoan,
    deleteLoan, deleteTxn, editTxn, addLoanTopUp,
    generateSingleReport, generateBulkReport, printStatement,
    calcLoanPreview, performRateUpdate
});

/** ============================================
 * UTILITY FUNCTIONS & HELPERS
 * ============================================ */

/**
 * DOM manipulation utilities
 */
const DOM = {
    show: (): void => {
        document.getElementById('lov')?.classList.add('show');
    },
    
    hide: (): void => {
        document.getElementById('lov')?.classList.remove('show');
    },
    
    setElementText: (id: string, text: any): void => {
        const element = document.getElementById(id);
        if (element) element.textContent = text;
    },
    
    setElementHTML: (id: string, html: string): void => {
        const element = document.getElementById(id);
        if (element) element.innerHTML = html;
    },
    
    getElementValue: (id: string): string => {
        return ((document.getElementById(id) as any)?.value || '').trim();
    },
    
    setElementValue: (id: string, value: any): void => {
        const element = document.getElementById(id) as any;
        if (element) element.value = value;
    },
    
    hideElement: (id: string): void => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    },
    
    showElement: (id: string): void => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'block';
    },
    
    toggleClass: (id: string, className: string, force?: boolean): void => {
        const element = document.getElementById(id);
        if (element) {
            if (force === undefined) {
                element.classList.toggle(className);
            } else {
                element.classList.toggle(className, force);
            }
        }
    }
};

/**
 * String and number formatting utilities
 */
const Format = {
    /**
     * Get today's date in YYYY-MM-DD format
     */
    today: (): string => {
        return new Date().toLocaleDateString('en-CA');
    },
    
    /**
     * Format number as currency (Bengali Taka)
     */
    currency: (amount: number): string => {
        return Math.round(amount || 0).toLocaleString(CONFIG.CURRENCY_LOCALE, {
            maximumFractionDigits: CONFIG.CURRENCY_MAX_FRACTION_DIGITS
        });
    },
    
    /**
     * Parse date string to Date object with safe handling
     */
    parseDate: (dateStr: any): Date => {
        const str = String(dateStr);
        const fullStr = str + (str.includes('T') ? '' : 'T00:00:00');
        return new Date(fullStr);
    },
    
    /**
     * Format date in readable format
     */
    date: (dateVal: any): string => {
        if (!dateVal) return '';
        const date = Format.parseDate(dateVal);
        return date.toLocaleDateString(CONFIG.DATE_LOCALE);
    },
    
    /**
     * Check password with user prompt
     */
    checkPassword: (): boolean => {
        const pwd = prompt('🔐 Admin Password:');
        if (pwd === CONFIG.ADMIN_PASSWORD) return true;
        if (pwd !== null) alert('❌ Incorrect!');
        return false;
    }
};

/**
 * Show/hide utilities (backwards compatibility)
 */
const show = DOM.show;
const hide = DOM.hide;
const getToday = Format.today;
const tk = Format.currency;
const fmtDate = Format.date;
const checkPw = Format.checkPassword;

/** ============================================
 * CORE INITIALIZATION
 * ============================================ */

/**
 * Initialize the application
 */
async function initApp(): Promise<void> {
    try {
        // Wait for Supabase client to be ready
        const client = await ensureSupabaseReady();
        if (!client) {
            console.error('✗ Failed to get Supabase client');
            throw new Error('Supabase client not available');
        }
        
        db = client;
        console.log('✓ Database connection established in initApp');
        
        // Check authentication
        if (!localStorage.getItem('supabase_access_token')) {
            window.location.href = '../admin/login.html';
            return;
        }
        
        // Initialize date fields with today's date
        ['lDate', 'payDate'].forEach(id => {
            const element = document.getElementById(id) as HTMLInputElement;
            if (element && !element.value) {
                element.value = Format.today();
            }
        });

        // Check for IID parameter in URL
        const params = new URLSearchParams(window.location.search);
        const iid = params.get('iid');
        
        if (iid) {
            await openAccountByIid(iid);
        } else {
            await loadDashboard();
        }
    } catch (error) {
        console.error('Initialization failed:', error);
        throw error;
    }
}

/**
 * Handle back/forward navigation
 */
window.onpopstate = (): void => {
    const params = new URLSearchParams(window.location.search);
    const iid = params.get('iid');
    if (iid) {
        openAccountByIid(iid);
    } else if (AppState.lastView) {
        go(AppState.lastView);
    }
};

/**
 * Initialization trigger
 */
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
        initApp().catch(e => console.error('Init failed:', e));
    });
} else {
    initApp().catch(e => console.error('Init failed:', e));
}

/**
 * Open account by internal ID (IID)
 */
async function openAccountByIid(iid: string): Promise<void> {
    show();
    try {
        const iidValue = parseInt(iid, 10);
        if (isNaN(iidValue)) {
            throw new Error('Invalid IID format');
        }
        
        const { data: loan, error } = await db.from('loans')
            .select('id')
            .eq('iid', iidValue)
            .single();
            
        if (error || !loan) {
            throw new Error('Loan record not found');
        }
        
        await openAccount(loan.id, true);
    } catch (error) {
        console.error('Error opening account by IID:', error);
        await loadDashboard();
    } finally {
        hide();
    }
}

/** ============================================
 * INTEREST CALCULATION ENGINE
 * ============================================ */

/**
 * Calculate interest for a given period
 * @param principal - Principal amount
 * @param monthlyRate - Monthly interest rate as percentage
 * @param fromDate - Start date
 * @param toDate - End date
 * @returns Interest amount
 */
function calcInterest(
    principal: number,
    monthlyRate: number,
    fromDate: string | Date,
    toDate: string | Date
): number {
    const startDate = Format.parseDate(fromDate);
    const endDate = Format.parseDate(toDate);
    
    if (endDate <= startDate) return 0;
    
    // Calculate months between dates
    let months = (endDate.getFullYear() - startDate.getFullYear()) * 12 +
        (endDate.getMonth() - startDate.getMonth());
    
    // If end day is before start day, subtract one month
    if (endDate.getDate() < startDate.getDate()) months--;
    
    // Calculate partial month (days)
    const fullMonthDate = new Date(startDate);
    fullMonthDate.setMonth(fullMonthDate.getMonth() + months);
    const diffDays = (endDate.getTime() - fullMonthDate.getTime()) / (1000 * 60 * 60 * 24);
    
    const totalMonths = months + (diffDays / CONFIG.DAYS_IN_MONTH);
    return principal * (monthlyRate / 100) * totalMonths;
}

/**
 * Get loan balance with complete transaction history
 * @param loan - Loan record
 * @param forceRate - Override interest rate
 * @param targetDate - Calculate balance as of this date
 * @param preFetchedTxns - Pre-fetched transactions for optimization
 * @returns Loan balance information
 */
async function getLoanBalance(
    loan: Loan,
    forceRate: number | null = null,
    targetDate: string | null = null,
    preFetchedTxns: Transaction[] | null = null
): Promise<LoanBalance> {
    // Fetch or use pre-fetched transactions
    const transactions = preFetchedTxns || (await (async () => {
        const { data } = await db.from('loan_transactions')
            .select('*')
            .eq('loan_id', loan.id)
            .order('txn_date', { ascending: true })
            .order('loan_transactions_sl', { ascending: true });
        return (data || []) as Transaction[];
    })());
    
    // Parse rate change history from transaction remarks
    const rateHistory: RateHistory[] = [];
    transactions.forEach(txn => {
        const match = txn.remarks?.match(CONFIG.LOG_ENTRY_PATTERN);
        if (match) {
            rateHistory.push({
                date: txn.txn_date,
                old: parseFloat(match[1]),
                new: parseFloat(match[2]),
                type: match[3] as 'F' | 'T'
            });
        }
    });

    /**
     * Get the effective interest rate at a given date
     */
    const getRateAtDate = (date: string): number => {
        if (forceRate !== null) return forceRate;
        
        let activeRate = parseFloat(loan.interest_rate as any);
        // Find the latest rate change before this date
        for (let i = rateHistory.length - 1; i >= 0; i--) {
            if (date < rateHistory[i].date) {
                activeRate = rateHistory[i].old;
            } else {
                break;
            }
        }
        return activeRate;
    };

    // Initialize calculation variables
    let principal = parseFloat(loan.loan_amount as any);
    let interest_owed = 0;
    let lastDate = loan.loan_date;
    let totalPaid = 0;
    let totalInterestAccrued = 0;
    
    const dateRef = targetDate || Format.today();
    const closureDate = loan.status === 'closed' 
        ? (loan.closed_at?.split('T')[0] || dateRef) 
        : dateRef;

    // Initialize history with loan disbursement
    const history: HistoryEntry[] = [{
        date: loan.loan_date,
        desc: 'লোন প্রদান',
        debit: principal,
        credit: 0,
        balance: principal
    }];

    // Process each transaction
    for (const txn of transactions) {
        const segmentRate = getRateAtDate(lastDate);
        const interest = calcInterest(principal, segmentRate, lastDate, txn.txn_date);
        
        // Add interest entry if significant
        if (interest > CONFIG.PAYMENT_SPLIT_THRESHOLD) {
            totalInterestAccrued += interest;
            interest_owed += interest;
            
            const daysDiff = Math.round(
                (new Date(txn.txn_date).getTime() - new Date(lastDate).getTime()) / 
                (1000 * 60 * 60 * 24)
            );
            
            history.push({
                date: txn.txn_date,
                desc: `মুনাফা (${daysDiff} দিন) - ${segmentRate}%`,
                debit: interest,
                credit: 0,
                balance: principal + interest_owed,
                isInterest: true
            });
        }

        const amount = parseFloat(txn.amount as any);
        
        // Handle rate log entries
        if (txn.remarks?.includes('[[RLOG:')) {
            interest_owed -= amount;
            history.push({
                date: txn.txn_date,
                desc: txn.remarks.split('[[RLOG:')[0],
                debit: amount > 0 ? 0 : Math.abs(amount),
                credit: amount > 0 ? amount : 0,
                balance: principal + interest_owed,
                isLog: true
            });
        } 
        // Handle top-up loans (negative amount)
        else if (amount < 0) {
            principal += Math.abs(amount);
            history.push({
                date: txn.txn_date,
                desc: txn.remarks || 'অতিরিক্ত লোন প্রদান',
                debit: Math.abs(amount),
                credit: 0,
                balance: principal + interest_owed,
                isTxn: true,
                txId: txn.id
            });
        } 
        // Handle payments
        else {
            // Split payment between interest and principal
            if (txn.remarks?.includes('মুনাফা জমা')) {
                interest_owed -= amount;
            } else if (txn.remarks?.includes('আসল জমা')) {
                principal -= amount;
            } else {
                // Auto-split: interest first, then principal
                const toInterest = Math.min(amount, interest_owed);
                interest_owed -= toInterest;
                principal -= (amount - toInterest);
            }
            
            totalPaid += amount;
            history.push({
                date: txn.txn_date,
                desc: txn.remarks || 'জমা',
                debit: 0,
                credit: amount,
                balance: principal + interest_owed,
                isTxn: true,
                txId: txn.id
            });
        }
        
        lastDate = txn.txn_date;
    }

    // Calculate current interest accrual
    const currentInterest = calcInterest(principal, parseFloat(loan.interest_rate as any), lastDate, closureDate);
    const totalRemaining = interest_owed + currentInterest;
    
    return {
        principal,
        lastDate,
        interest_owed: totalRemaining,
        currentDue: loan.status === 'closed' ? 0 : (principal + totalRemaining),
        totalPaid,
        totalInterest: totalInterestAccrued + currentInterest,
        history,
        currentInterest,
        preClosureDue: principal + totalRemaining,
        pending_interest: interest_owed
    };
}

// --- Dashboard Functions ---
/** Load and display dashboard with statistics */
async function loadDashboard(): Promise<void> {
    show();
    try {
        // Fetch all loans and transactions
        const { data: loans } = await db.from('loans').select('*');
        const { data: txns } = await db.from('loan_transactions')
            .select('*')
            .order('txn_date', { ascending: true })
            .order('loan_transactions_sl', { ascending: true });
        
        const allLoans = (loans || []) as Loan[];
        const allTxns = (txns || []) as Transaction[];
        
        // Initialize statistics
        const stats: DashboardStats = {
            active: 0, disbursed: 0, outAsol: 0, outMunafa: 0,
            collAsol: 0, collMunafa: 0, closed: 0, badAmt: 0, badCount: 0
        };
        
        // Calculate balances for all loans in parallel
        const balancePromises = allLoans.map(loan => {
            const loanTransactions = allTxns.filter(t => t.loan_id === loan.id);
            return getLoanBalance(loan, null, null, loanTransactions);
        });
        
        const results = await Promise.all(balancePromises);

        // Process results and update statistics
        results.forEach((balance, idx) => {
            const loan = allLoans[idx];
            if (loan.status === 'active') {
                stats.active++;
                stats.disbursed += parseFloat(loan.loan_amount as any);
                stats.outAsol += balance.principal;
                stats.outMunafa += balance.interest_owed;
            } else {
                stats.closed++;
                if (balance.preClosureDue > 1) {
                    stats.badCount++;
                    stats.badAmt += balance.preClosureDue;
                }
            }
        });

        // Calculate collected amounts from transactions
        for (const txn of allTxns) {
            const amount = parseFloat(txn.amount as any);
            if (amount > 0) {
                if (txn.remarks?.includes('আসল')) {
                    stats.collAsol += amount;
                } else {
                    stats.collMunafa += amount;
                }
            }
        }

        // Update dashboard UI
        DOM.setElementText('dActive', stats.active);
        DOM.setElementText('dActiveAmt', Format.currency(stats.disbursed));
        DOM.setElementText('dOutAsol', Format.currency(stats.outAsol));
        DOM.setElementText('dOutMunafa', Format.currency(stats.outMunafa));
        DOM.setElementText('dCollTotal', Format.currency(stats.collAsol + stats.collMunafa));
        DOM.setElementText('dCollSplit', 
            `Asol: ${Format.currency(stats.collAsol)} | Munafa: ${Format.currency(stats.collMunafa)}`);
        DOM.setElementText('dClosedCount', `${stats.closed} টি`);
        DOM.setElementText('dClosedBadAmt', Format.currency(stats.badAmt));
        DOM.setElementText('dClosedBadCount', `${stats.badCount} টি লোন`);

        // Update recent transactions table
        const recBd = document.getElementById('dRecBd');
        if (recBd) {
            recBd.innerHTML = allTxns.slice(-15).reverse().map(txn => {
                const loan = allLoans.find(x => x.id === txn.loan_id);
                return `<tr onclick="openAccount('${txn.loan_id}')" style="cursor:pointer">
                    <td>${Format.date(txn.txn_date)}</td>
                    <td>#${loan?.iid}</td>
                    <td>${loan?.name}</td>
                    <td style="color:var(--red);text-align:right">${txn.amount < 0 ? Format.currency(-txn.amount) : '-'}</td>
                    <td style="color:var(--green);text-align:right">${txn.amount > 0 ? Format.currency(txn.amount) : '-'}</td>
                </tr>`;
            }).join('');
        }
        
        await loadDashboardAlerts(allLoans, allTxns);
    } finally {
        hide();
    }
}

async function loadDashboardAlerts(loans: Loan[], allTxns: Transaction[]) {
    const div = document.getElementById('dashAlerts'); if (!div) return; div.innerHTML = '';
    const alerts: string[] = [];
    
    // Process only active loans
    const activeLoans = loans.filter(x => x.status === 'active');
    const balancePromises = activeLoans.map(l => {
        const lTxns = allTxns.filter(t => t.loan_id === l.id);
        return getLoanBalance(l, null, null, lTxns);
    });
    
    const balanceResults = await Promise.all(balancePromises);
    
    balanceResults.forEach((info, idx) => {
        const l = activeLoans[idx];
        const start = new Date(l.loan_date + 'T00:00:00');
        const end = new Date(start); end.setMonth(end.getMonth() + l.loan_months);
        const diff = Math.ceil((end.getTime() - new Date().getTime()) / (1000*60*60*24));
        
        if (diff <= 7) {
            alerts.push(`<div class="alert-card ${diff < 0 ? 'danger' : 'warning'}" onclick="openAccount('${l.id}')">
                <div class="alert-icon">${diff < 0 ? '🚨' : '⚠️'}</div>
                <div class="alert-body"><div class="alert-title">${l.name} (#${l.iid})</div><div class="alert-sub">${diff<0?`মেয়াদ শেষ`: (diff===0?'আজ শেষ':`বাকি ${diff} দিন`)}</div></div>
                <div style="font-weight:700;color:var(--red)">${tk(info.currentDue)}</div>
            </div>`);
        } else if (info.interest_owed > parseFloat(l.loan_amount as any)) {
            alerts.push(`<div class="alert-card warning" onclick="openAccount('${l.id}')">
                <div class="alert-icon">📈</div>
                <div class="alert-body"><div class="alert-title">${l.name} - সুদ আসলের উপরে!</div><div class="alert-sub">বকেয়া মুনাফা: ${tk(info.interest_owed)}</div></div>
            </div>`);
        }
    });

    div.innerHTML = alerts.join('');
}

// --- Navigation ---
function go(id: string, el?: HTMLElement) {
    if(id !== 'acct' && id !== 'acctEdit') {
        AppState.lastView = id;
        // Clear iid from URL if not in account view
        if (window.location.search.includes('iid=')) {
            const url = new URL(window.location.href);
            url.searchParams.delete('iid');
            window.history.pushState({}, '', url);
        }
    }

    document.querySelectorAll('.tc').forEach(t => t.classList.remove('on'));
    const target = document.getElementById('t-' + id);
    if (target) target.classList.add('on');

    // Reset sub-views for account
    if (id === 'acct') {
        const ac = document.getElementById('acctContent');
        const ae = document.getElementById('acctEdit');
        if (ac) ac.style.display = 'block';
        if (ae) ae.style.display = 'none';
    }

    document.querySelectorAll('.tab').forEach(b => b.classList.remove('on'));
    if (el) el.classList.add('on'); 
    else {
        const tab = document.querySelector(`.tab[onclick*="'${id}'"]`);
        if (tab) tab.classList.add('on');
        else if (id === 'dash') document.querySelector('.tab[onclick*="dash"]')?.classList.add('on');
        else if (id === 'all') document.querySelector('.tab[onclick*="all"]')?.classList.add('on');
        else if (id === 'new') document.querySelector('.tab[onclick*="new"]')?.classList.add('on');
    }

    if (id === 'dash') loadDashboard(); 
    if (id === 'all') loadAllLoans();
}
function goBack() { if (document.getElementById('acctEdit')?.style.display === 'block') openAccount(AppState.activeLoanId!); else go(AppState.lastView); }
function showAllLoans(f = 'all') { (document.getElementById('allFilter') as HTMLSelectElement).value = f; go('all'); }

// --- Search & Lists ---
async function searchLoans() {
    const q = (document.getElementById('searchQ') as HTMLInputElement).value.trim();
    const div = document.getElementById('searchResults')!;
    if (!q) { div.innerHTML = ''; loadAllLoans(); return }
    
    show(); try {
        let query = db.from('loans').select('*');
        if (/^\d+$/.test(q)) {
            query = query.or(`iid.eq.${q},mobile.ilike.%${q}%,name.ilike.%${q}%`);
        } else {
            query = query.ilike('name', `%${q}%`);
        }
        
        const { data, error } = await query.limit(20);
        if (error) throw error;
        const results = data || [];
        if (!results.length) { 
            div.innerHTML = '<div class="fc" style="text-align:center;color:var(--muted);padding:20px">😔 No results found</div>'; 
            return; 
        }
        let html = '<div class="th" style="padding:8px 0;border:none"><h3>🔍 Search Results</h3></div>';
        for (const loan of results) {
            const info = await getLoanBalance(loan);
            html += `<div class="product-card" style="cursor:pointer;margin-bottom:10px;border-color:var(--accent)" onclick="openAccount('${loan.id}')">
                <h3><span class="iid">#${loan.iid}</span> ${loan.name} 
                <span class="tbg ${loan.status === 'active' ? 't-active' : 't-closed'}">${loan.status === 'active' ? 'Active' : 'Closed'}</span></h3>
                <div class="row"><span>📱 Mobile</span><span>${loan.mobile}</span></div>
                <div class="row"><span>💰 Loan</span><span style="font-weight:700">${tk(parseFloat(loan.loan_amount as any))}</span></div>
                <div class="row" style="background:${info.currentDue > 0 ? 'var(--red-bg)' : 'var(--green-bg)'}">
                    <span style="font-weight:700">Due (Interest Incl.)</span>
                    <span style="font-weight:800;color:${info.currentDue > 0 ? 'var(--red)' : 'var(--green)'}">${tk(info.currentDue)}</span></div>
            </div>`;
        }
        div.innerHTML = html;
        div.scrollIntoView({ behavior: 'smooth' });
    } catch (e:any) { console.error(e); alert(e.message) } finally { hide(); }
}

async function loadAllLoans() {
    const resDiv = document.getElementById('searchResults');
    if (resDiv) resDiv.innerHTML = '';
    
    show(); try {
        const f = (document.getElementById('allFilter') as HTMLSelectElement).value;
        let q = db.from('loans').select('*').order('created_at', { ascending: false });
        if (f !== 'all') q = q.eq('status', f);
        const { data } = await q; const rows = data || [];
        const bg = document.getElementById('allBg'); if(bg) bg.textContent = rows.length.toString();
        const bd = document.getElementById('allBd'); if(bd) bd.innerHTML = rows.length ? rows.map((r: any) => `<tr onclick="openAccount('${r.id}')" style="cursor:pointer">
            <td><span class="iid">${r.iid}</span></td><td>${fmtDate(r.loan_date)}</td><td>${r.name}</td><td>${r.mobile}</td>
            <td style="font-weight:700">${tk(parseFloat(r.loan_amount as any))}</td>
            <td><span class="tbg ${r.status === 'active' ? 't-active' : 't-closed'}">${r.status === 'active' ? 'সক্রিয়' : 'বন্ধ'}</span></td></tr>`).join('')
            : '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted)">📭 No data</td></tr>';
    } catch (e) { console.error(e) } finally { hide(); }
}


// --- Account ---
async function openAccount(id: string, skipPush = false) {
    AppState.activeLoanId = id; show(); try {
        const { data: loan, error } = await db.from('loans').select('*').eq('id', id).single();
        if (error) throw error;
        const info = await getLoanBalance(loan);
        const div = document.getElementById('acctContent')!;

        if (!skipPush) {
            const url = new URL(window.location.href);
            url.searchParams.set('iid', loan.iid);
            window.history.pushState({ loanId: loan.id }, '', url);
        }

        // Calculate loan term info using local midnight for accuracy
        const start = new Date(loan.loan_date + (loan.loan_date.includes('T') ? '' : 'T00:00:00'));
        const loanEnd = new Date(start);
        loanEnd.setMonth(loanEnd.getMonth() + parseInt(loan.loan_months as any));
        
        const todayRef = new Date(); todayRef.setHours(0,0,0,0);
        const daysLeft = Math.ceil((loanEnd.getTime() - todayRef.getTime()) / (1000*60*60*24));

        div.innerHTML = `
        <!-- PROFILE HEADER -->
        <div class="profile-hdr">
            ${loan.photo_url
                ? `<img src="${loan.photo_url}" class="profile-avatar" onclick="window.open('${loan.photo_url}')">`
                : `<div class="profile-avatar-placeholder">👤</div>`}
            <div class="profile-info">
                <div style="font-size:20px; font-weight:800">${loan.name}</div>
                <div style="display:flex; align-items:center; gap:8px; margin-top:4px; margin-bottom:8px">
                    <span class="iid">#${loan.iid}</span>
                    <span class="tbg ${loan.status === 'active' ? 't-active' : 't-closed'}" style="font-size:10px; padding:2px 8px; font-weight:700">
                        ${loan.status === 'active' ? '🟢 সক্রিয়' : '🔴 বন্ধ'}
                    </span>
                </div>
                <div class="profile-meta" style="display:flex; align-items:center; gap:8px">
                    <span style="font-size:16px; font-weight:800; color:var(--text)">📱 ${loan.mobile}</span>
                    <a href="tel:${loan.mobile}" class="eb" style="width:24px; height:24px; font-size:12px; text-decoration:none">📞</a>
                    <span style="font-size:11px; margin-left:5px">🪪 ${loan.nid_number || 'N/A'}</span>
                </div>
                <div class="profile-meta">
                    <span>📅 ${fmtDate(loan.loan_date)}</span>
                    <span>📆 ${loan.loan_months} মাস</span>
                    <span>📊 ${parseFloat(loan.interest_rate as any).toFixed(2).replace(/\.00$/, '')}%/মাস</span>
                </div>
                ${loan.deposit_item ? `<div class="profile-meta"><span>🏷️ জামানত: <b>${loan.deposit_item}</b></span></div>` : ''}
                ${loan.nid_photo_url ? `<div style="margin-top:6px"><img src="${loan.nid_photo_url}" style="height:50px;border-radius:6px;border:1px solid var(--border);cursor:pointer" onclick="window.open('${loan.nid_photo_url}')"> <span style="font-size:10px;color:var(--muted)">NID</span></div>` : ''}
            </div>
        </div>

        <!-- SUMMARY STRIP -->
        <div class="summary-strip">
            <div class="summary-item"><div class="sv" style="color:var(--blue)">${tk(loan.loan_amount)}</div><div class="sl">💰 মূল লোন</div></div>
            <div class="summary-item"><div class="sv" style="color:var(--blue)">${tk(info.principal)}</div><div class="sl">📉 বর্তমান আসল</div></div>
            <div class="summary-item"><div class="sv" style="color:var(--orange)">${tk(info.interest_owed)}</div><div class="sl">📈 বকেয়া মুনাফা</div></div>
            <div class="summary-item"><div class="sv" style="color:var(--green)">${tk(info.totalPaid)}</div><div class="sl">💵 মোট জমা</div></div>
            <div class="summary-item"><div class="sv" style="color:${info.currentDue > 0 ? 'var(--red)' : 'var(--green)'}">${tk(info.currentDue)}</div><div class="sl">💸 মোট বকেয়া</div></div>
            <div class="summary-item">
                <div class="sv" style="color:${daysLeft > 0 ? 'var(--purple)' : 'var(--red)'}">
                    ${fmtDate(loanEnd)} <span style="font-size:10px; font-weight:400">(${daysLeft > 0 ? daysLeft + ' দিন বাকি' : 'শেষ'})</span>
                </div>
            </div>
        </div>

        ${info.totalInterest > parseFloat(loan.loan_amount as any) ? `<div style="padding:10px;background:var(--red-bg);border-radius:8px;margin-bottom:12px;font-size:12px;font-weight:700;color:var(--red);text-align:center">⚠️ মুনাফার পরিমাণ আসলের চেয়ে বেশি হয়ে গেছে!</div>` : ''}

        ${loan.status === 'active' ? `<div style="margin-bottom:16px">
            <button class="sbtn" style="background:var(--green)" onclick="openPayModal('${loan.id}')">💵 টাকা জমা দিন</button>
        </div>` : '<div style="text-align:center;padding:12px;background:var(--green-bg);border-radius:10px;margin-bottom:16px;font-weight:700;color:var(--green)">✅ এই লোন বন্ধ হয়েছে</div>'}

        <!-- BANK STATEMENT -->
        <div class="tw"><div class="th"><h3>📊 ব্যাংক স্টেটমেন্ট</h3><span class="badge">${info.history.length}</span></div>
        <div style="overflow-x:auto"><table><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Description</th><th style="color:var(--red); text-align:center">Debit</th><th style="color:var(--green); text-align:center">Credit</th><th style="text-align:center">Balance</th></tr></thead>
        <tbody>${info.history.map((h: any) => `<tr${h.isInterest ? ' style="background:#fffbeb"' : h.isClosure ? ' style="background:var(--red-bg); font-weight:700"' : ''}>
            <td>${fmtDate(h.date)}</td><td>${h.desc}</td>
            <td style="color:var(--red);font-weight:600; text-align:right">${h.debit > 0 ? tk(h.debit) : '-'}</td>
            <td style="color:var(--green);font-weight:600; text-align:right">${h.credit > 0 ? tk(h.credit) : '-'}</td>
            <td style="font-weight:700; text-align:right">${tk(h.balance)}</td>
        </tr>`).join('')}
        <tr style="background:#f0f2f5;font-weight:700;border-top:2px solid var(--border)">
            <td colspan="2" style="text-align:right">বর্তমান স্থিতি (${fmtDate(getToday())}):</td>
            <td style="color:var(--orange); text-align:right">+${tk(info.currentInterest)} (নতুন মুনাফা)</td>
            <td style="color:var(--blue); text-align:right">আসল: ${tk(info.principal)}<br>মুনাফা: ${tk(info.pending_interest)}</td>
            <td style="color:var(--red); font-size:14px; font-weight:900; text-align:right">মোট: ${tk(info.currentDue)}</td>
        </tr></tbody></table></div></div>

        ${loan.remarks ? `<div style="padding:10px;background:#f9fafb;border-radius:8px;font-size:12px;color:var(--muted);margin-bottom:12px">📝 ${loan.remarks}</div>` : ''}

        ${loan.status === 'active' ? `<div style="display:flex; justify-content:center; margin-top:20px; padding-bottom:20px">
            <button class="profile-btn danger" style="padding:6px 16px; font-size:11px" onclick="closeLoan('${loan.id}')">🚫 লোন বন্ধ করুন (Close Loan)</button>
        </div>` : ''}
`;

        go('acct');
        document.getElementById('acctContent')!.style.display = 'block';
        const editDiv = document.getElementById('acctEdit');
        if (editDiv) editDiv.style.display = 'none';
        window.scrollTo(0, 0);
    } catch (e:any) { console.error(e); alert(e.message) } finally { hide() }
}

// --- Payment ---
async function openPayModal(id: string) {
    show(); try {
        const { data: l } = await db.from('loans').select('*').eq('id', id).single();
        const info = await getLoanBalance(l);
        const todayStr = getToday();
        (document.getElementById('payDate') as HTMLInputElement).value = todayStr;
        (document.getElementById('payLoanId') as HTMLInputElement).value = id;
        (document.getElementById('payAmount') as HTMLInputElement).value = '';
        (document.getElementById('payAsol') as HTMLInputElement).value = '';
        (document.getElementById('payMunafa') as HTMLInputElement).value = '';
        (document.getElementById('payRemarks') as HTMLInputElement).value = '';
        (document.getElementById('paySt') as HTMLElement).style.display = 'none';

        (document.getElementById('payRateHidden') as HTMLInputElement).value = l.interest_rate;
        (document.getElementById('payDueHidden') as HTMLInputElement).value = String(info.currentDue);
        (document.getElementById('payInterestHidden') as HTMLInputElement).value = String(info.interest_owed);
        (document.getElementById('payStartDateHidden') as HTMLInputElement).value = l.loan_date;
        document.getElementById('payModalName')!.textContent = l.name;
        
        const infoDiv = document.getElementById('payCalcInfo')!;
        infoDiv.style.display = 'block';
        infoDiv.innerHTML = `
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; padding:10px; background:var(--blue-bg); border-radius:8px; border:1px solid var(--blue); margin-bottom:12px; font-size:11px">
                <div><div style="color:var(--muted); font-size:9px">আসল বকেয়া</div><div style="font-weight:700">${tk(info.principal)}</div></div>
                <div><div style="color:var(--muted); font-size:9px">বকেয়া মুনাফা</div><div style="font-weight:700">${tk(info.interest_owed)}</div></div>
                <div><div style="color:var(--muted); font-size:9px">মোট পাওনা</div><div style="font-weight:900; color:var(--red)">${tk(info.currentDue)}</div></div>
            </div>`;
        document.getElementById('payModal')!.classList.add('on');
    } finally { hide() }
}
async function updatePayModalInfo() {
    const id = (document.getElementById('payLoanId') as HTMLInputElement).value;
    const date = (document.getElementById('payDate') as HTMLInputElement).value;
    show(); const { data: l } = await db.from('loans').select('*').eq('id', id).single();
    const info = await getLoanBalance(l, null, date); hide();
    (document.getElementById('payDueHidden') as HTMLInputElement).value = String(info.currentDue);
    (document.getElementById('payInterestHidden') as HTMLInputElement).value = String(info.interest_owed);
    const infoDiv = document.getElementById('payCalcInfo')!;
    infoDiv.style.display = 'block';
    infoDiv.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; padding:10px; background:var(--blue-bg); border-radius:8px; border:1px solid var(--blue); margin-bottom:12px; font-size:11px">
            <div><div style="color:var(--muted); font-size:9px">আসল (${fmtDate(date)})</div><div style="font-weight:700">${tk(info.principal)}</div></div>
            <div><div style="color:var(--muted); font-size:9px">মুনাফা (${fmtDate(date)})</div><div style="font-weight:700">${tk(info.interest_owed)}</div></div>
            <div><div style="color:var(--muted); font-size:9px">মোট পাওনা</div><div style="font-weight:900; color:var(--red)">${tk(info.currentDue)}</div></div>
        </div>`;
    calcPaySplit();
}
function calcPaySplit() {
    let t = parseFloat((document.getElementById('payAmount') as HTMLInputElement).value) || 0;
    const due = parseFloat((document.getElementById('payDueHidden') as HTMLInputElement).value);
    const iDue = parseFloat((document.getElementById('payInterestHidden') as HTMLInputElement).value);
    
    if (t > due + 0.01) { 
        t = parseFloat(due.toFixed(2)); 
        (document.getElementById('payAmount') as HTMLInputElement).value = t.toString(); 
    }
    
    // First, cover interest
    let m = Math.min(t, iDue);
    m = parseFloat(m.toFixed(2));
    let a = parseFloat((t - m).toFixed(2));
    
    (document.getElementById('payMunafa') as HTMLInputElement).value = t > 0 ? m.toString() : '';
    (document.getElementById('payAsol') as HTMLInputElement).value = t > 0 ? a.toString() : '';
}
function syncPayTotal() {
    const m = parseFloat((document.getElementById('payMunafa') as HTMLInputElement).value) || 0;
    const a = parseFloat((document.getElementById('payAsol') as HTMLInputElement).value) || 0;
    const due = parseFloat((document.getElementById('payDueHidden') as HTMLInputElement).value) || 0;
    if (m + a > due + 0.01) { alert("মোট পাওনা এর বেশি জমা করা যাবে না!"); return; }
    (document.getElementById('payAmount') as HTMLInputElement).value = (m+a) > 0 ? (m+a).toFixed(2) : '';
}
async function savePayment(e: Event) {
    e.preventDefault(); const b = document.getElementById('payBtn') as HTMLButtonElement; b.disabled = true; show();
    try {
        const id = (document.getElementById('payLoanId') as HTMLInputElement).value;
        const d = (document.getElementById('payDate') as HTMLInputElement).value;
        const m = parseFloat((document.getElementById('payMunafa') as HTMLInputElement).value) || 0;
        const a = parseFloat((document.getElementById('payAsol') as HTMLInputElement).value) || 0;
        const payAmtTotal = parseFloat((m + a).toFixed(2));
        
        const { data: l } = await db.from('loans').select('*').eq('id', id).single();
        const info = await getLoanBalance(l, null, d);
        
        if (payAmtTotal <= 0) throw new Error("জমার পরিমাণ দিন!");
        if (payAmtTotal > parseFloat(info.currentDue.toFixed(2)) + 0.01) {
            throw new Error(`মোট পাওনা (${tk(info.currentDue)}) এর থেকে বেশি জমা করা যাবে না।`);
        }

        const rem = (document.getElementById('payRemarks') as HTMLInputElement).value || '';
        const batch = [];
        if (a > 0) batch.push({ loan_id: id, txn_date: d, amount: parseFloat(a.toFixed(2)), txn_type: 'payment', remarks: (rem ? rem + ' - ' : '') + "আসল জমা" });
        if (m > 0) batch.push({ loan_id: id, txn_date: d, amount: parseFloat(m.toFixed(2)), txn_type: 'payment', remarks: (rem ? rem + ' - ' : '') + "মুনাফা জমা" });
        
        if (batch.length === 0 && payAmtTotal > 0) {
            batch.push({ loan_id: id, txn_date: d, amount: payAmtTotal, txn_type: 'payment', remarks: rem });
        }
        
        if (batch.length > 0) {
            const { error } = await db.from('loan_transactions').insert(batch);
            if (error) throw error;
        }

        const balanceAfter = info.currentDue - payAmtTotal;
        const st = document.getElementById('paySt')!; st.style.display = 'block';
        st.style.background = 'var(--green-bg)'; st.style.color = 'var(--green)';
        
        if (balanceAfter <= 0.01) {
            await db.from('loans').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', id);
            alert('✅ সম্পূর্ণ পরিশোধ হয়েছে! লোন বন্ধ করা হয়েছে।');
        } else {
            st.textContent = `✅ ${tk(payAmtTotal)} জমা! মুনাফা: ${tk(m)}, আসল: ${tk(a)}`;
        }
        
        setTimeout(() => { closePayModal(); openAccount(id); b.disabled=false }, 800);
    } catch(err:any) { 
        const st = document.getElementById('paySt')!; st.style.display = 'block';
        st.style.background = 'var(--red-bg)'; st.style.color = 'var(--red)';
        st.textContent = '❌ ' + (err.message || String(err)); b.disabled = false; 
    } hide();
}

// --- Edits ---
async function saveLoan(e: Event) {
    e.preventDefault(); const b = document.getElementById('lBtn') as HTMLButtonElement; b.disabled = true; show();
    try {
        const p = await uploadImage((document.getElementById('lPhoto') as HTMLInputElement).files?.[0], 'loan_photos');
        const n = await uploadImage((document.getElementById('lNidPhoto') as HTMLInputElement).files?.[0], 'loan_nid');
        const payload = {
            name: (document.getElementById('lName') as HTMLInputElement).value, 
            mobile: (document.getElementById('lMobile') as HTMLInputElement).value,
            nid_number: (document.getElementById('lNid') as HTMLInputElement).value || null, 
            loan_date: (document.getElementById('lDate') as HTMLInputElement).value,
            loan_amount: parseFloat((document.getElementById('lAmount') as HTMLInputElement).value), 
            interest_rate: parseFloat((document.getElementById('lRate') as HTMLInputElement).value),
            loan_months: parseInt((document.getElementById('lMonths') as HTMLInputElement).value), 
            deposit_item: (document.getElementById('lDeposit') as HTMLInputElement).value || null,
            photo_url: p, nid_photo_url: n, 
            remarks: (document.getElementById('lRemarks') as HTMLInputElement).value || null,
            status: 'active'
        };
        const { data, error } = await db.from('loans').insert([payload]).select();
        if (error) throw error; 
        
        const st = document.getElementById('lSt')!;
        st.style.display = 'block'; st.style.background = 'var(--green-bg)'; st.style.color = 'var(--green)';
        st.textContent = `✅ লোন তৈরি হয়েছে! IID: #${data[0].iid}`;
        
        setTimeout(() => {
            (document.getElementById('loanForm') as HTMLFormElement).reset();
            (document.getElementById('lPhotoPreview') as HTMLImageElement).style.display = 'none';
            (document.getElementById('lNidPreview') as HTMLImageElement).style.display = 'none';
            st.style.display = 'none'; b.disabled = false;
            openAccount(data[0].id);
        }, 800);
    } catch(err:any) { 
        alert(err.message); 
        b.disabled = false;
    } finally { hide(); }
}
function showEditView(title: string, html: string, type: string, loan: any) {
    const editArea = document.getElementById('acctEdit')!;
    const contentArea = document.getElementById('acctContent')!;
    contentArea.style.display = 'none';
    editArea.style.display = 'block';
    
    editArea.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1.5px solid var(--border); padding-bottom:12px">
            <h2 style="margin:0; font-size:16px">${title}</h2>
            <button class="profile-btn" type="button" onclick="openAccount('${loan.id}')">✕ বন্ধ করুন</button>
        </div>
        
        <div style="display:flex; gap:12px; align-items:center; background:#f9fafb; padding:12px; border-radius:10px; margin-bottom:15px; border:1px solid var(--border)">
            ${loan.photo_url 
                ? `<img src="${loan.photo_url}" style="width:50px;height:50px;border-radius:10px;object-fit:cover;border:2px solid var(--blue)">` 
                : `<div style="width:50px;height:50px;background:var(--blue-bg);color:var(--blue);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;border:2px solid var(--blue)">👤</div>`}
            <div>
                <div style="font-weight:800; font-size:15px">${loan.name} <span class="iid" style="margin-left:5px">#${loan.iid}</span></div>
                <div style="font-size:11px; color:var(--muted); margin-top:2px; display:flex; gap:10px; flex-wrap:wrap">
                    <span>📱 ${loan.mobile}</span>
                    <span>📈 ${loan.interest_rate}%/মাস</span>
                    <span>📅 ${fmtDate(loan.loan_date)}</span>
                </div>
            </div>
            <div style="margin-left:auto"><span class="tbg ${loan.status === 'active' ? 't-active' : 't-closed'}" style="font-size:9px">${loan.status === 'active' ? 'সক্রিয়' : 'বন্ধ'}</span></div>
        </div>

        <form id="pEditForm" onsubmit="return saveEditForm(event)">
            <input type="hidden" id="editLoanId" value="${loan.id}">
            <input type="hidden" id="editType" value="${type}">
            <div id="editFields">${html}</div>
            <div class="fst" id="editSt" style="margin-top:12px"></div>
            <div style="display:flex; gap:10px; margin-top:20px">
                <button type="submit" class="sbtn" style="flex:2" id="editBtn">💾 Update</button>
                <button type="button" class="sbtn" style="flex:1; background:#6b7280" onclick="openAccount('${loan.id}')">Close</button>
            </div>
        </form>
    `;
    editArea.scrollIntoView({ behavior: 'smooth' });
}

async function editFullInfo(id?: string) {
    const lid = id || AppState.activeLoanId;
    if (!lid) return;
    show(); const { data: loan } = await db.from('loans').select('*').eq('id', lid).single();
    const { data: txns } = await db.from('loan_transactions').select('*').eq('loan_id', lid).order('txn_date', { ascending: false });
    hide();
    const transactions = txns || [];
    
    const html = `
        <div style="margin-bottom:20px">
            <h3 style="font-size:13px; color:var(--accent); margin-bottom:10px; border-bottom:1px solid var(--border); padding-bottom:5px">👤 গ্রাহকের তথ্য</h3>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
                <div class="fi"><label>পূর্ণ নাম</label><input type="text" id="edName" value="${loan.name}" required></div>
                <div class="fi"><label>মোবাইল নম্বর</label><input type="tel" id="edMobile" value="${loan.mobile}" required></div>
                <div class="fi f2"><label>NID নম্বর</label><input type="text" id="edNid" value="${loan.nid_number || ''}"></div>
                <div class="fi f2"><label>জামানত (বন্ধক রাখা জিনিস)</label><input type="text" id="edDeposit" value="${loan.deposit_item || ''}"></div>
                <div class="fi f2"><label>অতিরিক্ত মন্তব্য</label><input type="text" id="edRemarks" value="${loan.remarks || ''}"></div>
            </div>
        </div>
        
        <div style="margin-bottom:20px">
            <h3 style="font-size:13px; color:var(--accent); margin-bottom:10px; border-bottom:1px solid var(--border); padding-bottom:5px">💰 লোনের তথ্য</h3>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
                <input type="hidden" id="edOldRate" value="${loan.interest_rate}">
                <div class="fi"><label>লোনের পরিমাণ</label><input type="number" id="edAmount" step=".01" value="${loan.loan_amount}" required></div>
                <div class="fi"><label>সুদের হার (%)</label><input type="number" id="edRate" step=".01" value="${loan.interest_rate}" required></div>
                <div class="fi"><label>মেয়াদ (মাস)</label><input type="number" id="edMonths" value="${loan.loan_months}" required></div>
                <div class="fi"><label>লোনের তারিখ</label><input type="date" id="edDate" value="${loan.loan_date}" required></div>
            </div>
            <div class="fi" style="margin-top:10px"><label>বর্তমান স্ট্যাটাস</label><select id="edStatus">
                <option value="active" ${loan.status==='active'?'selected':''}>সক্রিয় (Active)</option>
                <option value="closed" ${loan.status==='closed'?'selected':''}>বন্ধ (Closed)</option>
            </select></div>
        </div>

        <div style="margin-bottom:20px">
            <h3 style="font-size:13px; color:var(--accent); margin-bottom:10px; border-bottom:1px solid var(--border); padding-bottom:5px">📷 ছবি পরিবর্তন</h3>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
                <div class="fi"><label>নতুন ছবি</label>
                    <div class="img-upload"><label for="edPhoto">📷 ছবি আপলোড</label><input type="file" id="edPhoto" accept="image/*" onchange="previewImg(this,'edPhotoPreview')">
                    <img id="edPhotoPreview" class="img-preview" ${loan.photo_url ? `src="${loan.photo_url}" style="display:block"` : 'style="display:none"'}></div></div>
                <div class="fi"><label>নতুন NID ছবি</label>
                    <div class="img-upload"><label for="edNidPhoto">🪪 NID আপলোড</label><input type="file" id="edNidPhoto" accept="image/*" onchange="previewImg(this,'edNidPreview')">
                    <img id="edNidPreview" class="img-preview" ${loan.nid_photo_url ? `src="${loan.nid_photo_url}" style="display:block"` : 'style="display:none"'}></div></div>
            </div>
        </div>
        
        <div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top:1.5px solid var(--border); margin-top:20px; padding-top:15px">
                 <label style="color:var(--text); font-weight:800; font-size:12px">💸 লেনদেন ম্যানেজমেন্ট</label>
                 <button type="button" class="profile-btn" style="background:var(--blue-bg); color:var(--blue); border-color:var(--blue); font-size:11px" onclick="addLoanTopUp('${lid}')">➕ নতুন লোন প্রদান (Top-up)</button>
            </div>
            <div class="fi f2" style="margin-top:10px">
                <div style="max-height:250px; overflow-y:auto; border:1px solid var(--border); border-radius:10px">
                    <table style="width:100%; border-collapse:collapse; font-size:11px">
                        <thead style="background:#f8f9fa; position:sticky; top:0; z-index:1">
                            <tr>
                                <th style="padding:6px; font-weight:800; font-size:10px">তারিখ</th>
                                <th style="padding:6px; font-weight:800; font-size:10px; color:var(--red); text-align:center">Debit</th>
                                <th style="padding:6px; font-weight:800; font-size:10px; color:var(--green); text-align:center">Credit</th>
                                <th style="padding:6px; font-weight:800; font-size:10px">বিবরণ (Remarks)</th>
                                <th style="padding:6px; font-weight:800; font-size:10px">অ্যাকশন</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${transactions.map((t: any) => {
                                const isTopUp = parseFloat(t.amount) < 0;
                                const displayAmt = Math.abs(parseFloat(t.amount));
                                return `<tr style="border-top:1px solid #f0f0f0; background:${isTopUp ? '#fef2f2' : 'transparent'}">
                                    <td style="padding:6px">${fmtDate(t.txn_date)}</td>
                                    <td style="padding:6px; font-weight:700; color:var(--red); text-align:right">${isTopUp ? tk(displayAmt) : '-'}</td>
                                    <td style="padding:6px; font-weight:700; color:var(--green); text-align:right">${!isTopUp ? tk(displayAmt) : '-'}</td>
                                    <td style="padding:6px; font-size:10px; color:var(--muted)">${t.remarks || '-'}</td>
                                    <td style="padding:8px; text-align:center; white-space:nowrap">
                                        <button type="button" class="eb" style="width:26px; height:26px; font-size:12px" onclick="editTxn('${t.id}','${lid}', '${t.txn_date}', ${t.amount}, '${(t.remarks||"").replace(/'/g, "\\'")}')">✏️</button>
                                        <button type="button" class="db" style="width:26px; height:26px; font-size:12px" onclick="deleteTxn('${t.id}','${lid}', true)">🗑️</button>
                                    </td>
                                </tr>`;
                            }).join('') || '<tr><td colspan="5" style="text-align:center; padding:15px; color:#999">কোনো লেনদেন নেই</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>`;
    showEditView('✏️ গ্রাহক ও লোনের তথ্য পরিবর্তন', html, 'full', loan);
}

async function saveEditForm(e: Event) {
    e.preventDefault(); const type = (document.getElementById('editType') as HTMLInputElement).value;
    if (!checkPw()) return;
    show(); try {
        const id = (document.getElementById('editLoanId') as HTMLInputElement).value;
        const oldRate = parseFloat((document.getElementById('edOldRate') as HTMLInputElement)?.value || "0");
        let upd: any = {};
        
        if (type === 'full') {
            upd = {
                name: (document.getElementById('edName') as HTMLInputElement).value, mobile: (document.getElementById('edMobile') as HTMLInputElement).value,
                loan_date: (document.getElementById('edDate') as HTMLInputElement).value, loan_amount: parseFloat((document.getElementById('edAmount') as HTMLInputElement).value),
                interest_rate: parseFloat((document.getElementById('edRate') as HTMLInputElement).value), loan_months: parseInt((document.getElementById('edMonths') as HTMLInputElement).value),
                deposit_item: (document.getElementById('edDeposit') as HTMLInputElement).value, status: (document.getElementById('edStatus') as HTMLSelectElement).value,
                remarks: (document.getElementById('edRemarks') as HTMLInputElement).value
            };
            
            // Handle image uploads
            const p = (document.getElementById('edPhoto') as HTMLInputElement).files?.[0];
            const n = (document.getElementById('edNidPhoto') as HTMLInputElement).files?.[0];
            if (p) upd.photo_url = await uploadImage(p, 'loan_photos');
            if (n) upd.nid_photo_url = await uploadImage(n, 'loan_nid');

            if (upd.status === 'closed') upd.closed_at = new Date().toISOString(); else upd.closed_at = null;
            if (upd.interest_rate !== oldRate) { hide(); performRateUpdate(id, upd, 'choice', oldRate); return; }
        }
        await performRateUpdate(id, upd, 'full', oldRate);
    } catch(err:any) { alert(err.message) } finally { hide() }
}
async function performRateUpdate(loanId: string, upd: any, type: string, oldRate: number, customDate: string | null = null) {
    if (type === 'choice') {
        const m = document.getElementById('choiceModal')!; m.classList.add('on');
        document.getElementById('choiceFull')!.onclick = () => performRateUpdate(loanId, upd, 'full', oldRate);
        document.getElementById('choiceToday')!.onclick = () => performRateUpdate(loanId, upd, 'today', oldRate);
        document.getElementById('choiceCustom')!.onclick = () => { const d = prompt("তারিখ:", getToday()); if(d) performRateUpdate(loanId, upd, 'custom', oldRate, d); };
        return;
    }
    document.getElementById('choiceModal')!.classList.remove('on'); show();
    try {
        const dNow = getToday();
        if (type !== 'full') {
            const dEff = (type === 'today') ? dNow : (customDate || dNow);
            await db.from('loan_transactions').insert([{ loan_id: loanId, txn_date: dEff, amount: 0, txn_type: 'adjustment', remarks: "📉 হার পরিবর্তন: " + oldRate + "% -> " + upd.interest_rate + "% [[RLOG:" + oldRate + ":" + upd.interest_rate + ":T]]" }]);
        } else if (oldRate > 0 && oldRate !== upd.interest_rate) {
            await db.from('loan_transactions').insert([{ loan_id: loanId, txn_date: dNow, amount: 0, txn_type: 'adjustment', remarks: "🔄 হার সমন্বয়: " + oldRate + "% -> " + upd.interest_rate + "% [[RLOG:" + oldRate + ":" + upd.interest_rate + ":F]]" }]);
        }
        await db.from('loans').update(upd).eq('id', loanId); openAccount(loanId);
    } catch (e:any) { alert(e.message) } finally { hide() }
}

// --- Utils ---
async function uploadImage(file: File | undefined, folderName: string): Promise<string | null> {
    if (!file) return null;
    
    const finalFile = file.size > CONFIG.MAX_IMAGE_SIZE 
        ? await compressImage(file) 
        : file;
    
    const path = `${folderName}/${Date.now()}_${file.name}`;
    await db.storage.from(CONFIG.BUCKET).upload(path, finalFile);
    return db.storage.from(CONFIG.BUCKET).getPublicUrl(path).data.publicUrl;
}
async function compressImage(file: File): Promise<File> {
    return new Promise(r => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image(); img.src = e.target!.result as string;
            img.onload = () => {
                const c = document.createElement('canvas'); const ctx = c.getContext('2d')!;
                let w = img.width, h = img.height; if (w > 1200 || h > 1200) { if (w > h) { h *= 1200/w; w = 1200; } else { w *= 1200/h; h = 1200; } }
                c.width = w; c.height = h; ctx.drawImage(img, 0, 0, w, h);
                c.toBlob(b => r(new File([b!], file.name, {type: 'image/jpeg'})), 'image/jpeg', 0.8);
            }
        }
    });
}
function previewImg(i: HTMLInputElement, pId: string) {
    const f = i.files?.[0]; if(!f) return;
    const r = new FileReader(); r.onload = e => { const img = document.getElementById(pId) as HTMLImageElement; img.src = e.target!.result as string; img.style.display = 'block'; };
    r.readAsDataURL(f);
}
function deleteTxn(tid: string, lid: string, mod = false) { if(checkPw() && confirm("Delete?")) { db.from('loan_transactions').delete().eq('id', tid).then(() => { openAccount(lid); if(mod) editFullInfo(lid); }); } }
async function deleteLoan(id: string) { if(checkPw() && confirm("Delete record?")) { await db.from('loans').delete().eq('id', id); go('dash'); } }
async function closeLoan(id: string) { if(confirm("Close Account?") && checkPw()) { await db.from('loans').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', id); openAccount(id); } }
function editTxn(id: string, lid: string, d: string, a: number, r: string) {
    const isTu = a < 0;
    document.getElementById('editModalTitle')!.textContent = '✏️ Edit Transaction';
    document.getElementById('modalFields')!.innerHTML = `<input type="hidden" id="txId" value="${id}"><div class="fi"><label>Date</label><input type="date" id="txD" value="${d}" required></div><div class="fi"><label>Amt</label><input type="number" id="txA" value="${Math.abs(a)}" required></div><div class="fi"><label>Rem</label><input id="txR" value="${r||''}"></div>`;
    document.getElementById('editForm')!.onsubmit = async (e) => { e.preventDefault(); if(!checkPw()) return; show();
        let v = parseFloat((document.getElementById('txA') as HTMLInputElement).value); if(isTu) v = -v;
        await db.from('loan_transactions').update({ txn_date: (document.getElementById('txD') as HTMLInputElement).value, amount: v, remarks: (document.getElementById('txR') as HTMLInputElement).value }).eq('id', id);
        document.getElementById('editModal')!.classList.remove('on'); hide(); openAccount(lid); editFullInfo(lid);
    };
    document.getElementById('editModal')!.classList.add('on');
}
function addLoanTopUp(id: string) {
    document.getElementById('editModalTitle')!.textContent = '➕ Top-up লোন';
    document.getElementById('modalFields')!.innerHTML = `<div class="fi"><label>Date</label><input type="date" id="tuD" value="${getToday()}" required></div><div class="fi"><label>Amt</label><input type="number" id="tuA" required></div><div class="fi"><label>Rem</label><input id="tuR" value="অতিরিক্ত প্রদান"></div>`;
    document.getElementById('editForm')!.onsubmit = async (e) => { e.preventDefault(); if(!checkPw()) return; show();
        const a = -Math.abs(parseFloat((document.getElementById('tuA') as HTMLInputElement).value));
        await db.from('loan_transactions').insert([{ loan_id: id, txn_date: (document.getElementById('tuD') as HTMLInputElement).value, amount: a, txn_type: 'adjustment', remarks: (document.getElementById('tuR') as HTMLInputElement).value || "Top-up" }]);
        document.getElementById('editModal')!.classList.remove('on'); hide(); openAccount(id); editFullInfo(id);
    };
    document.getElementById('editModal')!.classList.add('on');
}
async function renderLoanStatement(loan: any) {
    const info = await getLoanBalance(loan);
    const startDate = new Date(loan.loan_date);
    const endDate = new Date(loan.loan_date);
    endDate.setMonth(endDate.getMonth() + (loan.loan_months || 0));
    
    return `<div style="page-break-after: always; padding: 15px; border: 1.5px solid #000; margin-bottom: 30px; color:#000; font-family: ${CONFIG.PDF_FONT_STACK}; text-rendering: optimizeLegibility; letter-spacing: 0; word-spacing: 0;">
        <div style="text-align:center; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:5px">
            <h2 style="margin:0; font-size:14px; opacity:0.8">💰Statement</h2>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px;">
            <div style="flex:1">
                <div style="display:inline-block; background:#000; color:#fff; padding:2px 6px; font-weight:800; font-size:11px; margin-bottom:6px; border-radius:2px">ID: ${loan.iid}</div>
                <h2 style="margin:0; font-size:18px; font-weight:900; text-transform:uppercase">${loan.name}</h2>
                <div style="font-size:10px; margin-top:5px; display:grid; grid-template-columns: repeat(2, 1fr); gap:4px">
                    <span><b>📞 মোবাইল:</b> ${loan.mobile}</span>
                    <span><b>💰 সুদের হার:</b> ${loan.interest_rate}%</span>
                    <span><b>📅 শুরুর তারিখ:</b> ${fmtDate(loan.loan_date)}</span>
                    <span><b>📅 শেষের তারিখ:</b> ${fmtDate(endDate.toISOString())}</span>
                    <span><b>⏳ মেয়াদ:</b> ${loan.loan_months} মাস</span>
                    <span><b>📦 জামানত:</b> ${loan.deposit_item || 'নেই'}</span>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px">
                ${loan.photo_url ? `<img src="${loan.photo_url}" style="width:70px; height:70px; border:2.5px solid #000; object-fit:cover; border-radius:6px">` : 
                `<div style="width:70px; height:70px; border:2.5px solid #000; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:30px; background:#f0f0f0">👤</div>`}
                <div style="text-align:right">
                    <span style="font-size:9px; font-weight:700; display:block; margin-bottom:2px">স্ট্যাটাস</span>
                    <span style="padding:4px 8px; border:2px solid #000; font-weight:900; font-size:10px; display:inline-block">${loan.status === 'active' ? 'সক্রিয়' : 'বন্ধ'}</span>
                </div>
            </div>
        </div>
        
        <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 20px;">
            <div style="border:1.5px solid #000; padding:8px; text-align:center; background:#f8f9fa">
                <div style="font-size:8px; font-weight:900; text-transform:uppercase; margin-bottom:4px">আসল লোন</div>
                <div style="font-size:11px; font-weight:900">${tk(loan.loan_amount)}</div>
            </div>
            <div style="border:1.5px solid #000; padding:8px; text-align:center; background:#f8f9fa">
                <div style="font-size:8px; font-weight:900; text-transform:uppercase; margin-bottom:4px">মোট মুনাফা</div>
                <div style="font-size:11px; font-weight:900">${tk(info.totalInterest)}</div>
            </div>
            <div style="border:1.5px solid #000; padding:8px; text-align:center; background:#f8f9fa">
                <div style="font-size:8px; font-weight:900; text-transform:uppercase; margin-bottom:4px">মোট জমা</div>
                <div style="font-size:11px; font-weight:900">${tk(info.totalPaid)}</div>
            </div>
            <div style="border:1.5px solid #000; padding:8px; text-align:center; background:#f8f9fa">
                <div style="font-size:8px; font-weight:900; text-transform:uppercase; margin-bottom:4px">বর্তমান বাকি</div>
                <div style="font-size:11px; font-weight:900">${tk(info.currentDue)}</div>
            </div>
        </div>

        <div style="border:1.5px solid #000; padding:6px; background:#000; color:#fff; font-weight:700; font-size:11px; margin-bottom:8px; font-family: ${CONFIG.PDF_FONT_STACK};">
            📝 লেনদেনের স্টেটমেন্ট
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:10px; color:#000; font-family: ${CONFIG.PDF_FONT_STACK}; letter-spacing:0; word-spacing:0;">
            <thead>
                <tr style="font-family: ${CONFIG.PDF_FONT_STACK};">
                    <th style="border:1.5px solid #000; padding:6px; text-align:left; background:#e9ecef">Date</th>
                    <th style="border:1.5px solid #000; padding:6px; text-align:left; background:#e9ecef">Description</th>
                    <th style="border:1.5px solid #000; padding:6px; text-align:center; background:#e9ecef">Debit</th>
                    <th style="border:1.5px solid #000; padding:6px; text-align:center; background:#e9ecef">Credit</th>
                    <th style="border:1.5px solid #000; padding:6px; text-align:center; background:#e9ecef">Balance</th>
                </tr>
            </thead>
            <tbody>
                ${info.history.map((h: any) => `<tr style="${h.isClosure ? 'background:#f0f0f0; font-weight:800' : ''}">
                    <td style="border:1px solid #000; padding:6px;">${fmtDate(h.date)}</td>
                    <td style="border:1px solid #000; padding:6px;">${h.desc}</td>
                    <td style="border:1px solid #000; padding:6px; text-align:right">${h.debit > 0 ? tk(h.debit) : '-'}</td>
                    <td style="border:1px solid #000; padding:6px; text-align:right">${h.credit > 0 ? tk(h.credit) : '-'}</td>
                    <td style="border:1px solid #000; padding:6px; text-align:right">${tk(h.balance)}</td>
                </tr>`).join('')}
                ${(loan.status === 'active' && info.currentInterest > 0) ? `
                <tr style="background:#f8f9fa; font-weight:800">
                    <td style="border:1px solid #000; padding:6px;">${fmtDate(new Date().toISOString())}</td>
                    <td style="border:1px solid #000; padding:6px;">আজকের হিসাব (মুনাফাসহ)</td>
                    <td style="border:1px solid #000; padding:6px; text-align:right">${tk(info.currentInterest)}</td>
                    <td style="border:1px solid #000; padding:6px; text-align:right">-</td>
                    <td style="border:1px solid #000; padding:6px; text-align:right">${tk(info.currentDue)}</td>
                </tr>` : ''}
            </tbody>
            <tfoot>
                <tr style="background:#f8f9fa; font-weight:900">
                    <td colspan="4" style="border:1.5px solid #000; padding:8px; text-align:right; font-size:11px">Remaining Due Balance:</td>
                    <td style="border:1.5px solid #000; padding:8px; text-align:right; font-size:13px">${tk(info.currentDue)}</td>
                </tr>
            </tfoot>
        </table>
        
        <div style="margin-top:40px; display:flex; justify-content:flex-end">
            <div style="text-align:center; width:150px">
                <div style="border-top:1.5px solid #000; padding-top:4px; font-size:10px">গ্রাহকের স্বাক্ষর</div>
            </div>
        </div>
    </div>`;
}


// Helper to wait for images and generate/save PDF
async function printWithImages(filename = 'Statement.pdf') {
    const printArea = document.getElementById('pa');
    const element = document.getElementById('paC');
    if (!printArea || !element) return;
    
    const oldPaStyle = printArea.getAttribute('style') || '';
    const oldElementStyle = element.getAttribute('style') || '';

    printArea.style.display = 'block';
    printArea.style.position = 'fixed';
    printArea.style.left = '-10000px';
    printArea.style.top = '0';
    printArea.style.width = '794px';
    printArea.style.background = '#fff';
    printArea.style.padding = '0';

    element.style.width = '794px';
    element.style.maxWidth = '794px';
    element.style.margin = '0';
    element.style.transform = 'none';

    await new Promise(resolve => requestAnimationFrame(resolve));

    const imgs = element.querySelectorAll('img');
    const promises = Array.from(imgs).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
            img.onload = resolve; img.onerror = resolve;
        });
    });
    await Promise.all(promises);
    
    // Safety check: ensure all fonts are fully loaded before rendering
    if ((document as any).fonts && (document as any).fonts.ready) {
        await (document as any).fonts.ready;
        await Promise.allSettled([
            (document as any).fonts.load(`400 14px ${CONFIG.PDF_FONT_STACK}`),
            (document as any).fonts.load(`600 14px ${CONFIG.PDF_FONT_STACK}`),
            (document as any).fonts.load(`700 14px ${CONFIG.PDF_FONT_STACK}`)
        ]);
    }

    try {
        const jsPDFCtor = (window as any).jspdf && (window as any).jspdf.jsPDF;
        if (!jsPDFCtor) {
            const opt = {
                margin: [0, 0, 0, 0],
                filename: filename,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: {
                    scale: 2,
                    width: 794,
                    windowWidth: 794,
                    useCORS: true,
                    letterRendering: false,
                    foreignObjectRendering: false,
                    scrollX: 0,
                    scrollY: 0,
                    allowTaint: true
                },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['css', 'legacy'] }
            };
            await (window as any).html2pdf().set(opt).from(element).save();
            return;
        }

        const pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const blocks = Array.from(element.children).filter((node: any) => node.offsetHeight > 0);

        if (!blocks.length) return;

        let isFirstPdfPage = true;
        for (const block of blocks) {
            const canvas = await (window as any).html2canvas(block, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                width: Math.ceil((block as any).scrollWidth),
                windowWidth: Math.ceil((block as any).scrollWidth),
                scrollX: 0,
                scrollY: 0
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.98);
            const imgWidth = pageWidth;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            if (!isFirstPdfPage) pdf.addPage();
            isFirstPdfPage = false;

            if (imgHeight <= pageHeight) {
                pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
            } else {
                let heightLeft = imgHeight;
                let position = 0;
                pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;

                while (heightLeft > 0) {
                    position -= pageHeight;
                    pdf.addPage();
                    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
                    heightLeft -= pageHeight;
                }
            }
        }

        pdf.save(filename);
    } finally {
        if (oldPaStyle) printArea.setAttribute('style', oldPaStyle);
        else printArea.removeAttribute('style');

        if (oldElementStyle) element.setAttribute('style', oldElementStyle);
        else element.removeAttribute('style');
    }
}

async function generateSingleReport() {
    if (!AppState.activeLoanId) return alert("প্রথমে একটি একাউন্ট খুলুন!");
    show(); try {
        const { data: loan } = await db.from('loans').select('*').eq('id', AppState.activeLoanId).single();
        if (!loan) return;
        document.getElementById('paC')!.innerHTML = await renderLoanStatement(loan);
        const safeName = loan.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        await printWithImages(`Statement_${loan.iid}_${safeName}.pdf`);
    } catch(e) { console.error(e); alert("PDF জেনারেট করতে সমস্যা হয়েছে।") } hide();
}

async function generateBulkReport() {
    const type = (document.getElementById('exportType') as HTMLSelectElement).value;
    if (!type) return;
    show();
    try {
        const { data: loans } = await db.from('loans').select('*').eq('status', type).order('iid', { ascending: true });
        let html = `<div style="text-align:center; padding: 10px 0; margin-bottom: 15px; border-bottom: 3px double #000;">
            <h1 style="margin:0; font-size:20px; letter-spacing:1px; color:#000">💰 লোন রিপোর্ট — ${type === 'active' ? 'সক্রিয়' : 'বন্ধ'}</h1>
            <p style="margin:2px 0; font-size:11px; font-weight:700; color:#000">তৈরির তারিখ: ${fmtDate(new Date().toISOString())}</p>
        </div>`;
        for (const loan of (loans || [])) {
            html += await renderLoanStatement(loan);
        }
        document.getElementById('paC')!.innerHTML = html;
        const dateStr = getToday();
        await printWithImages(`Bulk_Report_${type}_${dateStr}.pdf`);
        (document.getElementById('exportType') as HTMLSelectElement).value = '';
    } catch (e:any) {
        console.error(e);
        alert("রিপোর্ট জেনারেট করতে সমস্যা হয়েছে। " + e.message);
    }
    hide();
}

function printStatement() { generateSingleReport(); }
function calcLoanPreview() { /* stubbed calculation for demo */ }
function closeConfModal() { document.getElementById('confModal')?.classList.remove('on'); }
function closePayModal() { document.getElementById('payModal')?.classList.remove('on'); }
