import { supabase } from './supabase';

/** Configuration and Constants */
export const CONFIG = {
  BUCKET: 'accounting_db_bucket',
  MAX_IMAGE_SIZE: 199 * 1024,
  DAYS_IN_MONTH: 30,
  DATE_LOCALE: 'en-GB',
  CURRENCY_LOCALE: 'en-IN',
  CURRENCY_MAX_FRACTION_DIGITS: 0,
  LOG_ENTRY_PATTERN: /\[\[RLOG:([\d.]+):([\d.]+):(F|T)\]\]/,
  PAYMENT_SPLIT_THRESHOLD: 0.01,
} as const;

/** Type Definitions */
export type LoanStatus = 'active' | 'closed';

export interface Loan {
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

export interface Transaction {
  id: string;
  loan_id: string;
  txn_date: string;
  amount: number;
  remarks: string | null;
  txn_type?: 'payment' | 'adjustment';
  created_at: string;
}

export interface HistoryEntry {
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

export interface LoanBalance {
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

/** Formatting Utilities */

export const formatCurrency = (amount: number): string => {
  return Math.round(amount || 0).toLocaleString(CONFIG.CURRENCY_LOCALE, {
    maximumFractionDigits: CONFIG.CURRENCY_MAX_FRACTION_DIGITS,
  });
};

export const tk = formatCurrency;

export const parseDate = (dateStr: any): Date => {
  const str = String(dateStr);
  const fullStr = str + (str.includes('T') ? '' : 'T00:00:00');
  return new Date(fullStr);
};

export const formatDate = (dateVal: any): string => {
  if (!dateVal) return '';
  const date = parseDate(dateVal);
  return date.toLocaleDateString(CONFIG.DATE_LOCALE);
};

export const fmtDate = formatDate;

/** Calculation Engine */

export function calcInterest(
  principal: number,
  monthlyRate: number,
  fromDate: string | Date,
  toDate: string | Date
): number {
  const startDate = parseDate(fromDate);
  const endDate = parseDate(toDate);

  if (endDate <= startDate) return 0;

  let months =
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth());

  if (endDate.getDate() < startDate.getDate()) months--;

  const fullMonthDate = new Date(startDate);
  fullMonthDate.setMonth(fullMonthDate.getMonth() + months);
  const diffDays =
    (endDate.getTime() - fullMonthDate.getTime()) / (1000 * 60 * 60 * 24);

  const totalMonths = months + diffDays / CONFIG.DAYS_IN_MONTH;
  return principal * (monthlyRate / 100) * totalMonths;
}

export async function getLoanBalance(
  loan: Loan,
  forceRate: number | null = null,
  targetDate: string | null = null,
  preFetchedTxns: Transaction[] | null = null
): Promise<LoanBalance> {
  const transactions =
    preFetchedTxns ||
    (await (async () => {
      const { data } = await supabase
        .from('loan_transactions')
        .select('*')
        .eq('loan_id', loan.id)
        .order('txn_date', { ascending: true })
        .order('created_at', { ascending: true }); // Using created_at since loan_transactions_sl might not be in the current schema or we use created_at for tie-breaking
      return (data || []) as Transaction[];
    })());

  const rateHistory: any[] = [];
  transactions.forEach((txn) => {
    const match = txn.remarks?.match(CONFIG.LOG_ENTRY_PATTERN);
    if (match) {
      rateHistory.push({
        date: txn.txn_date,
        old: parseFloat(match[1]),
        new: parseFloat(match[2]),
        type: match[3],
      });
    }
  });

  const getRateAtDate = (date: string): number => {
    if (forceRate !== null) return forceRate;

    let activeRate = parseFloat(loan.interest_rate as any);
    for (let i = rateHistory.length - 1; i >= 0; i--) {
      if (date < rateHistory[i].date) {
        activeRate = rateHistory[i].old;
      } else {
        break;
      }
    }
    return activeRate;
  };

  let principal = parseFloat(loan.loan_amount as any);
  let interest_owed = 0;
  let lastDate = loan.loan_date;
  let totalPaid = 0;
  let totalInterestAccrued = 0;

  const dateRef = targetDate || new Date().toLocaleDateString('en-CA');
  const closureDate =
    loan.status === 'closed'
      ? loan.closed_at?.split('T')[0] || dateRef
      : dateRef;

  const history: HistoryEntry[] = [
    {
      date: loan.loan_date,
      desc: 'লোন প্রদান',
      debit: principal,
      credit: 0,
      balance: principal,
    },
  ];

  for (const txn of transactions) {
    const segmentRate = getRateAtDate(lastDate);
    const interest = calcInterest(principal, segmentRate, lastDate, txn.txn_date);

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
        isInterest: true,
      });
    }

    const amount = parseFloat(txn.amount as any);

    if (txn.remarks?.includes('[[RLOG:')) {
      interest_owed -= amount;
      history.push({
        date: txn.txn_date,
        desc: txn.remarks.split('[[RLOG:')[0],
        debit: amount > 0 ? 0 : Math.abs(amount),
        credit: amount > 0 ? amount : 0,
        balance: principal + interest_owed,
        isLog: true,
      });
    } else if (amount < 0) {
      principal += Math.abs(amount);
      history.push({
        date: txn.txn_date,
        desc: txn.remarks || 'অতিরিক্ত লোন প্রদান',
        debit: Math.abs(amount),
        credit: 0,
        balance: principal + interest_owed,
        isTxn: true,
        txId: txn.id,
      });
    } else {
      if (txn.remarks?.includes('মুনাফা জমা')) {
        interest_owed -= amount;
      } else if (txn.remarks?.includes('আসল জমা')) {
        principal -= amount;
      } else {
        const toInterest = Math.min(amount, interest_owed);
        interest_owed -= toInterest;
        principal -= amount - toInterest;
      }

      totalPaid += amount;
      history.push({
        date: txn.txn_date,
        desc: txn.remarks || 'জমা',
        debit: 0,
        credit: amount,
        balance: principal + interest_owed,
        isTxn: true,
        txId: txn.id,
      });
    }

    lastDate = txn.txn_date;
  }

  const currentInterest = calcInterest(
    principal,
    parseFloat(loan.interest_rate as any),
    lastDate,
    closureDate
  );
  const totalRemaining = interest_owed + currentInterest;

  return {
    principal,
    lastDate,
    interest_owed: totalRemaining,
    currentDue: loan.status === 'closed' ? 0 : principal + totalRemaining,
    totalPaid,
    totalInterest: totalInterestAccrued + currentInterest,
    history,
    currentInterest,
    preClosureDue: principal + totalRemaining,
    pending_interest: interest_owed,
  };
}

export function renderLoanStatement(loan: Loan, info: LoanBalance): string {
    const startDate = parseDate(loan.loan_date);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + (loan.loan_months || 0));
    
    return `<div style="padding: 10mm; margin: 0; color:#000; font-family: Inter, Arial, sans-serif; box-sizing: border-box; width: 190mm; background: #fff;">
        <div style="text-align:center; margin-bottom:15px; border-bottom:1.5pt solid #000; padding-bottom:8px">
            <h1 style="margin:0; font-size:18px; text-transform:uppercase; letter-spacing:1px">লোন স্টেটমেন্ট (LOAN STATEMENT)</h1>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px; page-break-inside: avoid;">
            <div style="flex:1">
                <div style="display:inline-block; background:#000; color:#fff; padding:4px 10px; font-weight:800; font-size:12px; margin-bottom:10px; border-radius:3px">ACC IID: ${loan.iid}</div>
                <h2 style="margin:0; font-size:24px; font-weight:900; color:#000">${loan.name}</h2>
                <div style="font-size:13px; margin-top:10px; display:grid; grid-template-columns: 1fr 1fr; gap:8px; line-height:1.6">
                    <div><b>📱 মোবাইল:</b> ${loan.mobile}</div>
                    <div><b>📊 সুদের হার:</b> ${loan.interest_rate}% /মাস</div>
                    <div><b>📅 শুরু:</b> ${fmtDate(loan.loan_date)}</div>
                    <div><b>📅 শেষ:</b> ${fmtDate(endDate.toISOString())}</div>
                    <div><b>⏳ মেয়াদ:</b> ${loan.loan_months} মাস</div>
                    <div><b>📦 জামানত:</b> ${loan.deposit_item || 'নেই'}</div>
                </div>
            </div>
            <div style="margin-left:20px; text-align:right">
                ${loan.photo_url ? `<img src="${loan.photo_url}" style="width:100px; height:100px; border:3px solid #000; object-fit:cover; border-radius:8px">` : 
                `<div style="width:100px; height:100px; border:3px solid #000; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:40px; background:#f8f9fa">👤</div>`}
                <div style="margin-top:10px">
                    <span style="padding:5px 12px; border:2.5px solid #000; font-weight:900; font-size:12px; display:inline-block; text-transform:uppercase">${loan.status === 'active' ? 'সক্রিয় (ACTIVE)' : 'বন্ধ (CLOSED)'}</span>
                </div>
            </div>
        </div>
        
        <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 30px; page-break-inside: avoid;">
            <div style="border:2px solid #000; padding:12px; text-align:center;">
                <div style="font-size:10px; font-weight:900; color:#666; text-transform:uppercase; margin-bottom:5px">মূল লোন</div>
                <div style="font-size:16px; font-weight:900">${tk(loan.loan_amount)}</div>
            </div>
            <div style="border:2px solid #000; padding:12px; text-align:center;">
                <div style="font-size:10px; font-weight:900; color:#666; text-transform:uppercase; margin-bottom:5px">মোট মুনাফা</div>
                <div style="font-size:16px; font-weight:900">${tk(info.totalInterest)}</div>
            </div>
            <div style="border:2px solid #000; padding:12px; text-align:center;">
                <div style="font-size:10px; font-weight:900; color:#666; text-transform:uppercase; margin-bottom:5px">মোট জমা</div>
                <div style="font-size:16px; font-weight:900">${tk(info.totalPaid)}</div>
            </div>
            <div style="border:2px solid #000; padding:12px; text-align:center;">
                <div style="font-size:10px; font-weight:900; color:#666; text-transform:uppercase; margin-bottom:5px">বর্তমান বাকি</div>
                <div style="font-size:16px; font-weight:900; color:#dc2626">${tk(info.currentDue)}</div>
            </div>
        </div>

        <div style="border:2px solid #000; padding:8px; background:#000; color:#fff; font-weight:900; font-size:13px; margin-bottom:0; page-break-inside: avoid;">
            📝 লেনদেনের বিস্তারিত স্টেটমেন্ট (Transaction Details)
        </div>
        <table style="width:100%; border-collapse:collapse; color:#000;">
            <thead>
                <tr>
                    <th style="border:2px solid #000; padding:10px; text-align:left; background:#f2f2f2; font-size:12px">তারিখ (Date)</th>
                    <th style="border:2px solid #000; padding:10px; text-align:left; background:#f2f2f2; font-size:12px">বিবরণ (Desc)</th>
                    <th style="border:2px solid #000; padding:10px; text-align:right; background:#f2f2f2; font-size:12px">ডেবিট (Dr.)</th>
                    <th style="border:2px solid #000; padding:10px; text-align:right; background:#f2f2f2; font-size:12px">ক্রেডিট (Cr.)</th>
                    <th style="border:2px solid #000; padding:10px; text-align:right; background:#f2f2f2; font-size:12px">ব্যালেন্স (Bal)</th>
                </tr>
            </thead>
            <tbody>
                ${info.history.map((h: any) => `
                <tr style="page-break-inside: avoid; ${h.isClosure ? 'background:#f9fafb; font-weight:bold' : ''}">
                    <td style="border:1px solid #000; padding:10px; font-size:12px">${fmtDate(h.date)}</td>
                    <td style="border:1px solid #000; padding:10px; font-size:12px">${h.desc}</td>
                    <td style="border:1px solid #000; padding:10px; font-size:12px; text-align:right">${h.debit > 0 ? tk(h.debit) : '-'}</td>
                    <td style="border:1px solid #000; padding:10px; font-size:12px; text-align:right">${h.credit > 0 ? tk(h.credit) : '-'}</td>
                    <td style="border:1px solid #000; padding:10px; font-size:12px; text-align:right; font-weight:800">${tk(h.balance)}</td>
                </tr>`).join('')}
                ${(loan.status === 'active' && info.currentInterest > 0) ? `
                <tr style="background:#fffbeb; font-weight:800; page-break-inside: avoid;">
                    <td style="border:1px solid #000; padding:10px; font-size:12px">${fmtDate(new Date().toISOString())}</td>
                    <td style="border:1px solid #000; padding:10px; font-size:12px">আজকের হিসাব (মুনাফাসহ)</td>
                    <td style="border:1px solid #000; padding:10px; font-size:12px; text-align:right">${tk(info.currentInterest)}</td>
                    <td style="border:1px solid #000; padding:10px; font-size:12px; text-align:right">-</td>
                    <td style="border:1px solid #000; padding:10px; font-size:12px; text-align:right">${tk(info.currentDue)}</td>
                </tr>` : ''}
            </tbody>
            <tfoot>
                <tr style="background:#f2f2f2; font-weight:900; page-break-inside: avoid;">
                    <td colspan="4" style="border:2px solid #000; padding:12px; text-align:right; font-size:14px">সর্বমোট বকেয়া (Remaining Due Balance):</td>
                    <td style="border:2px solid #000; padding:12px; text-align:right; font-size:16px; color:#dc2626">${tk(info.currentDue)}</td>
                </tr>
        </table>
        
        <div style="margin-top:20px; text-align:center; font-size:10px; color:#666; border-top:1px solid #eee; padding-top:10px">
            This is a computer generated statement.
        </div>
    </div>`;
}
