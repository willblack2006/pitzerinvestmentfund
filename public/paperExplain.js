// Why each paper-trading rule exists, in plain words, built from the season's own numbers.
const big = (n) => (n >= 1e9 ? `$${+(n / 1e9).toFixed(1)} billion` : `$${Math.round(n / 1e6)} million`);

export function ruleExplanations(r) {
  return [
    ["Every order needs a reason", "Write what you think the market is missing and what would prove you wrong. A trade you can't explain is a guess, and you can't learn from a guess."],
    ["Target and stop", "A target is where you'd say the idea has worked; a stop is where you'd admit it hasn't. Choosing both before you buy keeps you honest when the price moves."],
    [`Fee of ${(r.feeBps / 100).toFixed(2)}% a trade`, "Real trading isn't free, and frequent trading costs add up. The fee rewards trades you actually believe in."],
    [`At least ${r.minHoldings} holdings to be ranked`, "One stock can make anyone look brilliant for a semester. Holding several is how real funds survive being wrong, so the leaderboard only ranks diversified portfolios."],
    [`No more than ${r.maxPositionPct}% in one stock`, "Checked when you buy. Size is risk: even a good idea can fall 40%, and that should not be able to sink your whole portfolio."],
    [`Stocks over $${r.minPrice} and ${big(r.minMarketCap)}`, "Very cheap or very small stocks can swing wildly and are hard to trade in real life, so practice results there wouldn't carry over."],
    ["Orders outside market hours wait", "While the market is open an order fills at the live price. Otherwise it waits and fills at the next day's opening price, which can differ from what you saw."],
    ["Judge with risk, not just return", "A semester is too short to tell skill from luck. Look at the Sharpe ratio and the biggest drop too: a smaller gain with a smoother ride can be the better result."],
  ];
}

export function rulesExplainerHtml(r, esc) {
  return `<details class="explainer small paper-why"><summary>Why these rules?</summary>
    <dl class="paper-why-list">${ruleExplanations(r).map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join("")}</dl>
    <p class="muted">New to this? The <a href="#/learn">Start here</a> lesson on paper trading takes four minutes.</p></details>`;
}
