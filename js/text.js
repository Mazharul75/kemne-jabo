// Text normalisation and phonetic "skeleton" keys for Bangla + Banglish place names.
// Pure functions only — no DOM — so the same code runs in the browser and in tests.
//
// The skeleton reduces a word to its consonant frame so that মিরপুর, Mirpur, mirpoor
// and মীরপুর all land on the same key ("mrpr"). Vowels are the least stable part of
// both speech-to-text output and hand-typed Banglish, so we ignore them.

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

export const toAsciiDigits = (s) => s.replace(/[০-৯]/g, (c) => String(BN_DIGITS.indexOf(c)));
export const toBanglaDigits = (s) => String(s).replace(/[0-9]/g, (c) => BN_DIGITS[Number(c)]);

// Spoken / written number words → digits. Only used as whole tokens.
const NUMBER_WORDS = {
  // Bangla
  "শূন্য": "0", "এক": "1", "দুই": "2", "দুটি": "2", "তিন": "3", "চার": "4", "পাঁচ": "5", "পাচ": "5", "ছয়": "6", "ছয়": "6",
  "সাত": "7", "আট": "8", "নয়": "9", "নয়": "9", "দশ": "10", "এগারো": "11", "এগার": "11", "বারো": "12",
  "তেরো": "13", "তের": "13", "চৌদ্দ": "14", "চৌদ্দো": "14", "চোদ্দ": "14", "পনেরো": "15", "পনের": "15", "ষোল": "16", "ষোলো": "16",
  "সতেরো": "17", "সতের": "17", "আঠারো": "18", "আঠার": "18", "উনিশ": "19", "বিশ": "20", "সাতাশ": "27", "বত্রিশ": "32",
  // Bangla spelling of English numbers (very common in speech-to-text output)
  "ওয়ান": "1", "টু": "2", "থ্রি": "3", "ফোর": "4", "ফাইভ": "5", "সিক্স": "6", "সেভেন": "7", "এইট": "8", "নাইন": "9",
  "টেন": "10", "ইলেভেন": "11", "টুয়েলভ": "12", "থার্টিন": "13", "ফোরটিন": "14", "ফিফটিন": "15",
  // Banglish
  "ek": "1", "dui": "2", "tin": "3", "char": "4", "pach": "5", "panch": "5", "choy": "6", "chhoy": "6", "chay": "6",
  "sat": "7", "noy": "9", "dosh": "10", "dos": "10", "egaro": "11", "baro": "12", "tero": "13", "choddo": "14",
  "ponero": "15", "bish": "20", "satash": "27",
  // English
  "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8",
  "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14", "fifteen": "15",
  "sixteen": "16", "seventeen": "17", "eighteen": "18", "nineteen": "19", "twenty": "20",
};

// Words that describe the kind of place rather than which place. Dropped on both sides before matching.
const NOISE = new Set([
  "bus", "stand", "stop", "stoppage", "terminal", "area", "road", "rd", "the", "number", "no", "nongbor", "nomber", "nambar",
  "বাস", "স্ট্যান্ড", "স্ট্যান্ড", "স্টপ", "স্টপেজ", "টার্মিনাল", "এলাকা", "রোড", "মোড়", "মোড", "নম্বর", "নাম্বার", "নাম্বর", "নং",
  "আবাসিক", "গোলচত্বর", "ra", "r", "a",
]);

const ZERO_WIDTH = /[​‌‍⁠﻿]/g;

/** Lowercase, strip punctuation, unify digits, split digit/letter boundaries. Keeps number words as digits. */
export function normalize(input) {
  let s = String(input ?? "").normalize("NFC").replace(ZERO_WIDTH, "");
  s = toAsciiDigits(s).toLowerCase();
  s = s.replace(/[_\-–—/\\.,;:!?()[\]{}"'“”‘’।|+&]/g, " ");
  s = s.replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2");
  s = s.replace(/(\p{Script=Bengali})(\d)/gu, "$1 $2").replace(/(\d)(\p{Script=Bengali})/gu, "$1 $2");
  const out = s.split(/\s+/).filter(Boolean).map((t) => (t in NUMBER_WORDS ? NUMBER_WORDS[t] : t));
  return out.join(" ");
}

const BN_MAP = {
  "ক": "k",
  "খ": "k",
  "গ": "g",
  "ঘ": "g",
  "ঙ": "n",
  "চ": "C",
  "ছ": "C",
  "জ": "j",
  "ঝ": "j",
  "ঞ": "n",
  "ট": "t",
  "ঠ": "t",
  "ড": "d",
  "ঢ": "d",
  "ণ": "n",
  "ত": "t",
  "থ": "t",
  "দ": "d",
  "ধ": "d",
  "ন": "n",
  "প": "p",
  "ফ": "f",
  "ব": "b",
  "ভ": "b",
  "ম": "m",
  "য": "j",
  "র": "r",
  "ল": "l",
  "শ": "s",
  "ষ": "s",
  "স": "s",
  "হ": "H",
  "ৎ": "t",
  "ং": "n",
  "ঁ": "n",
};
const BN_VOWELS = /[অআইঈউঊঋএঐওঔািীুূৃেৈোৌঃ]/;

function bnToLatin(token) {
  let s = token
    .replace(/ক্ষ্ম/g, "k").replace(/ক্ষ/g, "k")
    .replace(/[ডঢ]়/g, "r").replace(/য়/g, "")
    .replace(/্য/g, "").replace(/্ব/g, "")
    .replace(/র্/g, "r");
  let out = "";
  for (const ch of s) {
    if (ch === "্") continue; // hasanta — consonants simply sit side by side
    if (BN_MAP[ch]) out += BN_MAP[ch];
    else if (BN_VOWELS.test(ch)) out += "a";
    else if (/[a-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

/** Consonant skeleton of one token. Digits pass through unchanged. */
export function skeleton(token) {
  if (/^\d+$/.test(token)) return token;
  let s = /\p{Script=Bengali}/u.test(token) ? bnToLatin(token) : token;
  s = s.replace(/tech/g, "tek");
  s = s.replace(/(.)\1+/g, "$1");
  s = s.replace(/chh?/g, "C").replace(/sh/g, "s").replace(/kh/g, "k").replace(/gh/g, "g").replace(/jh/g, "j")
    .replace(/th/g, "t").replace(/dh/g, "d").replace(/bh/g, "b").replace(/ph/g, "f");
  s = s.replace(/x/g, "ks").replace(/z/g, "j").replace(/q/g, "k").replace(/v/g, "b").replace(/c/g, "k");
  s = s.replace(/(.)\1+/g, "$1");
  s = s.replace(/[aeiouywĀ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return s;
}

/** Bangla case endings people attach to a place name: মতিঝিলে, ফার্মগেটে, মিরপুরের, গুলিস্তানকে ... */
const BN_SUFFIXES = ["ের", "তে", "কে", "য়", "টা", "র", "ে", "এ"];
export function suffixVariants(word) {
  const out = [word];
  if (!/\p{Script=Bengali}/u.test(word)) {
    if (/^[a-z]{4,}e$/.test(word)) out.push(word.slice(0, -1) + "");
    return out;
  }
  for (const suf of BN_SUFFIXES) {
    if (word.endsWith(suf) && word.length - suf.length >= 2) out.push(word.slice(0, -suf.length));
  }
  return [...new Set(out)];
}

/** Break a place string into { words: skeleton tokens, nums: digit tokens } with noise removed. */
export function placeKey(input) {
  const toks = normalize(input).split(" ").filter(Boolean);
  const words = [], nums = [];
  for (const t of toks) {
    if (/^\d+$/.test(t)) { nums.push(t); continue; }
    if (NOISE.has(t)) continue;
    const sk = skeleton(t);
    if (sk) words.push(sk);
  }
  return { words, nums };
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** How alike two skeleton words are, 0..1. `prefix` lets "mrp" match "mrpr" while the user is still typing. */
export function wordSim(a, b, prefix = false) {
  if (a === b) return 1;
  if (prefix && a.length >= 2 && b.startsWith(a)) return 0.92;
  if (a.length < 3 || b.length < 3) return 0;
  const r = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return r >= 0.74 ? r * 0.9 : 0;
}

const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Score a query key against a name key, 0..1. Numbers must match exactly ("Mirpur 1" is not "Mirpur 10"). */
export function scoreKeys(q, n, { prefix = false } = {}) {
  if (!q.words.length) return 0;
  if (q.nums.length && !eq(q.nums, n.nums)) {
    // while typing "mirpur 1" we may be on the way to "mirpur 10"
    const ok = prefix && n.nums.length === q.nums.length && n.nums.every((x, i) => x.startsWith(q.nums[i]));
    if (!ok) return 0;
  }
  let qCov = 0;
  q.words.forEach((qw, i) => {
    let best = 0;
    for (const nw of n.words) best = Math.max(best, wordSim(qw, nw, prefix && i === q.words.length - 1));
    qCov += best;
  });
  qCov /= q.words.length;
  if (qCov < 0.6) return 0;
  let nCov = 0;
  for (const nw of n.words) {
    let best = 0;
    for (const qw of q.words) best = Math.max(best, wordSim(qw, nw, prefix));
    nCov += best;
  }
  nCov = n.words.length ? nCov / n.words.length : 1;
  let score = qCov * (0.55 + 0.45 * nCov);
  if (!q.nums.length && n.nums.length) score *= 0.85;
  return Math.min(1, score);
}
