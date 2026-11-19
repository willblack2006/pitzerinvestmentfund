// The "Start here" path: short lessons tied to the places in the app where each idea shows up.
// `actions` are things a member can do; ones with a `done` key are checked automatically from what
// they've done (lib/learnProgress.js). Lessons are marked read by the member (pref learnRead).
export const LESSONS = [
  {
    id: "fund", title: "What the fund owns", minutes: 3,
    intro: "Before looking for new ideas, know what the fund already holds and how it is doing against a simple alternative.",
    points: [
      "Each holding has a weight: its share of the fund's value. A few big weights drive most of the result.",
      "Gain is measured against cost basis, what the fund paid. It stays unrealized until the shares are sold.",
      "The benchmark is the index the fund is graded against. If the fund trails it, a member could have done better by buying the index.",
    ],
    terms: ["weight", "costBasis", "unrealizedGain", "benchmark", "diversification"],
    actions: [{ label: "Open Holdings and find the three biggest weights", href: "#/" }, { label: "Check Performance against the benchmark", href: "#/performance" }],
    ask: "Explain the fund's three biggest positions to someone new to investing.",
  },
  {
    id: "company", title: "Read a company in ten minutes", minutes: 5,
    intro: "Start with the business, not the price chart. These questions come before any number.",
    points: [
      "How does it make money, and is revenue growing? Revenue is sales; margins show how much of each dollar is left.",
      "Does it produce free cash flow, or does it need to keep borrowing or selling shares?",
      "What did the company itself say recently? 8-K filings report events as they happen; the 10-K explains the business and its risks.",
    ],
    terms: ["revenue", "grossMargin", "freeCashFlow", "form8K", "piotroski"],
    actions: [
      { label: "Open any company's Research page (try a holding)", href: "#/research" },
      { label: "Follow a ticker or add one to a watchlist", href: "#/watchlist", done: "watchlist" },
      { label: "Write a note in your own words on what the company does", href: "#/notes", done: "note" },
    ],
    ask: "Walk me through how to read NVDA's financials as a beginner, one step at a time.",
  },
  {
    id: "value", title: "Price versus value", minutes: 5,
    intro: "A great company can be a bad stock if the price already assumes everything goes right.",
    points: [
      "P/E compares price to earnings. High is not bad by itself; it means the market expects growth. Compare to peers and to the company's own history.",
      "A DCF estimates what future cash is worth today. Small changes to growth or the discount rate move it a lot, so look at the sensitivity grid, not one number.",
      "Reverse DCF flips the question: what growth does today's price already assume, and is that believable?",
    ],
    terms: ["peRatio", "evEbitda", "wacc", "terminalGrowth", "reverseDcf", "priceTarget"],
    actions: [{ label: "Try the DCF and reverse DCF on the Valuation tab", href: "#/research" }],
    ask: "What growth rate is NVDA's current price assuming, and is that believable?",
  },
  {
    id: "risk", title: "Risk is how much you could lose", minutes: 4,
    intro: "Returns are only half the picture. Two funds can earn the same return with very different rides.",
    points: [
      "Volatility is how much the price bounces. Max drawdown is the worst fall from a peak: the ride an owner actually sat through.",
      "Beta shows how much a stock moves with the market. Correlation shows whether holdings move together; low correlation is what makes diversification work.",
      "Position size is risk control: the policy caps how much can sit in one stock or sector for a reason.",
    ],
    terms: ["volatility", "maxDrawdown", "beta", "correlation", "sharpe"],
    actions: [{ label: "See max drawdown and correlation on Performance", href: "#/performance" }, { label: "Check the policy limits on Allocation", href: "#/allocation" }],
    ask: "Which holding adds the most risk to the fund, and why?",
  },
  {
    id: "paper", title: "Practice with paper trading", minutes: 4,
    intro: "Paper trading is the safe place to be wrong. The goal is to learn from the calls, not to top the leaderboard.",
    points: [
      "Every order needs a reason. Write what you think the market is missing and what would prove you wrong.",
      "Set a target and a stop before you buy. A stop is the price where you admit you were wrong, decided while calm.",
      "Look at your trades again after a few weeks: did the reason play out, or did you get lucky?",
    ],
    terms: ["stopPrice", "priceTarget", "thesis", "alpha"],
    actions: [
      { label: "Place a paper order", href: "#/paper", done: "paperTrade" },
      { label: "Make it a real call: a reason, a target or stop", href: "#/paper", done: "paperThesis" },
    ],
    ask: "I'm about to make my first paper trade. What should I check before I place it?",
  },
  {
    id: "pitch", title: "Write a pitch that can be wrong", minutes: 6,
    intro: "A pitch is a short argument the whole fund can vote on and later grade. Make it checkable.",
    points: [
      "Thesis: one paragraph on why the stock should do well and what the market is missing.",
      "Catalysts are dated events that could change minds. Risks are what would make you wrong; write the bear case first.",
      "Give bull, base and bear price targets and a position size. The price at pitch time is saved so the call can be graded later.",
    ],
    terms: ["thesis", "catalyst", "scenarios", "priceTarget", "weight"],
    actions: [{ label: "Start a pitch (drafts are private until you open voting)", href: "#/pitches/new", done: "pitch" }],
    ask: "Review what makes a strong stock pitch, using the fund's template: thesis, catalysts, risks and valuation.",
  },
  {
    id: "vote", title: "Vote and learn from results", minutes: 3,
    intro: "Investing skill comes from being graded. Read other members' pitches, vote with a comment, and check how calls turned out.",
    points: [
      "A vote with a reason teaches more than a bare yes or no.",
      "The track record page grades past calls against the benchmark. Judge a process by many calls, not one.",
      "Brier score and hit rate need many calls before they mean much.",
    ],
    terms: ["hitRate", "brier", "survivorship"],
    actions: [{ label: "Vote on an open pitch with a comment", href: "#/pitches", done: "vote" }, { label: "Read the track record", href: "#/track-record" }],
    ask: "How should I judge whether a pitch was right, when it only played out over a few months?",
  },
];

export const ACTION_KEYS = LESSONS.flatMap((l) => l.actions.map((a) => a.done).filter(Boolean));

// Overall progress: lessons marked read plus automatic actions done.
export function learnSummary(done = {}, read = []) {
  const lessonsRead = LESSONS.filter((l) => read.includes(l.id)).length;
  const actionsDone = ACTION_KEYS.filter((k) => done[k]).length;
  const total = LESSONS.length + ACTION_KEYS.length;
  const count = lessonsRead + actionsDone;
  const next = LESSONS.find((l) => !read.includes(l.id) || l.actions.some((a) => a.done && !done[a.done]));
  return { count, total, pct: Math.round((count / total) * 100), finished: count === total, next };
}
