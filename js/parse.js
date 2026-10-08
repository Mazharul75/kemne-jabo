// Turns what someone said (or typed) into a From place and a To place.
//   "মিরপুর ১০ থেকে মতিঝিল"          from → to
//   "মতিঝিল যাবো মিরপুর ১০ থেকে"      to … from
//   "Mirpur 10 theke Uttara jabo"
//   "from Farmgate to Gulistan"
//   "আমি ফার্মগেটে আছি, মতিঝিল যেতে চাই"
//   "এখান থেকে মতিঝিল"                from = my location
// Pure functions: share them between the browser and the tests.

import { normalize } from "./text.js";

const FROM_POST = new Set(["থেকে", "থেকে", "হতে", "হইতে", "theke", "thekey", "thake", "hote", "hoite", "hoyte", "thaka"]);
const FROM_PRE = new Set(["from", "frm"]);
const TO_PRE = new Set(["to", "towards", "toward", "until", "till"]);
const TO_POST = new Set(["পর্যন্ত", "পর্জন্ত", "porjonto", "porjanto", "অভিমুখে"]);
const VERB_TO = new Set([
  "যাব", "যাবো", "যাবে", "যাবেন", "যাচ্ছি", "যাচ্ছ", "যাই", "যেতে", "যাওয়া", "যাওয়ার", "যাত্রা", "পৌঁছাতে", "পৌছাতে",
  "jabo", "jabo", "jaabo", "jai", "jacchi", "jachhi", "jete", "jaowa", "jawar", "jabe", "jaben", "go", "going", "reach",
]);
const STAY = new Set(["আছি", "আছো", "আছেন", "দাঁড়িয়ে", "achi", "achhi", "standing"]); // "X achi"
const AT_PRE = new Set(["at"]); // "I am at X"
const HERE = new Set(["এখান", "এখানে", "এখন", "ekhan", "ekhane", "here"]);
const FILLER = new Set([
  "আমি", "আমরা", "আমাকে", "আমার", "আমায়", "আপনি", "ami", "amar", "amake", "i", "me", "my", "we", "please", "plz", "pls", "ক", "দয়া", "করে",
  "চাই", "চাইছি", "চাচ্ছি", "চাই", "chai", "want", "wanna", "need", "like", "would", "can", "how", "কিভাবে", "কীভাবে", "কেমনে", "কেমন", "কোন", "কোনো",
  "kivabe", "kemne", "kon", "which", "get", "take", "the", "a", "an", "bus", "বাস", "বাসে", "bashe", "বলুন", "tell", "show", "find", "খুঁজুন", "দেখান",
  "এ", "তে", "কে", "র", "ের", "e", "te", "ke", "er", "টা", "ta", "হবে", "hobe", "লাগবে", "lagbe", "যেতে", "হবে", "ও", "এবং", "and", "then", "আর",
  "নাকি", "না", "ভাই", "ভাইয়া", "ভাই", "bhai", "vai", "ধন্যবাদ", "thanks", "থাকি", "থাকে",
]);

const MY_LOCATION = [
  /আমার\s*(অবস্থান|লোকেশন|জায়গা)/, /বর্তমান\s*(অবস্থান|লোকেশন)/, /my\s*(current\s*)?location/, /current\s*location/, /amar\s*location/,
];

const KIND = { FROM_POST: 1, FROM_PRE: 2, TO_PRE: 3, TO_POST: 4, VERB: 5, STAY: 6, HERE: 7, FILLER: 8, AT: 9, WORD: 0 };

function classify(t) {
  if (FROM_POST.has(t)) return KIND.FROM_POST;
  if (FROM_PRE.has(t)) return KIND.FROM_PRE;
  if (TO_PRE.has(t)) return KIND.TO_PRE;
  if (TO_POST.has(t)) return KIND.TO_POST;
  if (VERB_TO.has(t)) return KIND.VERB;
  if (STAY.has(t)) return KIND.STAY;
  if (AT_PRE.has(t)) return KIND.AT;
  if (HERE.has(t)) return KIND.HERE;
  if (FILLER.has(t)) return KIND.FILLER;
  return KIND.WORD;
}

/** "মিরপুরেথেকে" style run-ons: peel a trailing থেকে off a longer token. */
function splitRunOns(tokens) {
  const out = [];
  for (const t of tokens) {
    const m = t.match(/^(.{2,}?)(থেকে|হতে|theke)$/u);
    if (m && !FROM_POST.has(t)) out.push(m[1], m[2]);
    else out.push(t);
  }
  return out;
}

/**
 * @returns {{ from: string|null, to: string|null, fromHere: boolean, tokens: string[] }}
 *  `from`/`to` are raw place phrases (still need resolving); `fromHere` means "use my location".
 */
export function parseTrip(transcript) {
  const raw = String(transcript ?? "");
  const text = normalize(raw);
  const result = { from: null, to: null, fromHere: false, tokens: [] };
  if (!text) return result;

  const fromHereByPhrase = MY_LOCATION.some((re) => re.test(raw.toLowerCase()));
  const tokens = splitRunOns(text.split(" ").filter(Boolean));
  result.tokens = tokens;

  // Group consecutive place-ish tokens into phrases; remember the marker tokens right before and after each.
  const kinds = tokens.map((t) => (/^\d+$/.test(t) ? KIND.WORD : classify(t)));
  const real = [];
  for (let i = 0; i < tokens.length; ) {
    if (kinds[i] !== KIND.WORD) { i++; continue; }
    let j = i;
    while (j < tokens.length && kinds[j] === KIND.WORD) j++;
    // nearest meaningful marker on each side (fillers like "এ", "আমি" don't count)
    let before = [], after = [];
    for (let k = i - 1; k >= 0 && kinds[k] !== KIND.WORD; k--) if (kinds[k] !== KIND.FILLER) { before = [kinds[k]]; break; }
    for (let k = j; k < tokens.length && kinds[k] !== KIND.WORD; k++) if (kinds[k] !== KIND.FILLER) { after = [kinds[k]]; break; }
    real.push({ words: tokens.slice(i, j), before, after });
    i = j;
  }

  const label = (p) => {
    const a = new Set(p.after), b = new Set(p.before);
    if (a.has(KIND.FROM_POST) || b.has(KIND.FROM_PRE) || b.has(KIND.AT) || a.has(KIND.STAY)) return "from";
    if (b.has(KIND.TO_PRE) || a.has(KIND.TO_POST) || a.has(KIND.VERB)) return "to";
    return null;
  };
  // A bare "to" that follows a phrase means that phrase is the origin ("mirpur 10 to motijheel").
  const labelled = real.map((p) => ({ p, role: label(p) }));
  labelled.forEach((x, i) => {
    if (!x.role && x.p.after.includes(KIND.TO_PRE)) x.role = "from";
  });

  const fromPhrase = labelled.find((x) => x.role === "from");
  const toPhrase = labelled.find((x) => x.role === "to");
  const free = labelled.filter((x) => !x.role);

  const join = (x) => x.p.words.join(" ");
  if (fromPhrase) result.from = join(fromPhrase);
  if (toPhrase) result.to = join(toPhrase);

  // Fill the gaps with unlabelled phrases: first one is from (if we need one), the other is to.
  if (!result.from && !result.to) {
    if (free.length >= 2) { result.from = join(free[0]); result.to = join(free[1]); }
    else if (free.length === 1) result.to = join(free[0]);
  } else if (!result.to && free.length) {
    result.to = join(free[free.length - 1]);
  } else if (!result.from && free.length) {
    // "Y jabo" + "X" — the leftover is more likely the origin only when something marks it; otherwise ignore
    result.from = join(free[0]);
  }

  // "এখান থেকে …", "from here", "my location …"
  const hereToken = tokens.some((t) => HERE.has(t));
  if (fromHereByPhrase || (hereToken && !result.from)) result.fromHere = true;
  if (result.fromHere && result.from && MY_LOCATION.some((re) => re.test(result.from))) result.from = null;
  // phrases like "আমার অবস্থান" leak into words; drop them
  for (const k of ["from", "to"]) {
    if (result[k] && /^(অবস্থান|লোকেশন|location|জায়গা)$/.test(result[k])) result[k] = null;
  }
  if (result.fromHere) result.from = null;
  return result;
}

/** For a single field ("say the place"): strip fillers and verbs, keep the place words. */
export function cleanSinglePlace(transcript) {
  const t = normalize(transcript).split(" ").filter(Boolean);
  const keep = t.filter((x) => /^\d+$/.test(x) || classify(x) === KIND.WORD);
  return keep.join(" ");
}
