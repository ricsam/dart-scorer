import { useEffect } from 'react'
import { BarChart3, Calculator, Info, Trophy } from 'lucide-react'
import { useDocumentTitle } from '../hooks'

const sections = [
  ['what-counts', 'What counts'],
  ['scoring', 'Scoring & match rules'],
  ['statistics', 'Averages & statistics'],
  ['ratings', 'Room ratings (Elo)'],
  ['leaderboards', 'Reading the leaderboard'],
  ['checkouts', 'Checkout suggestions'],
] as const

// Keep these explanations aligned with src/game/{engine,entry,stats,checkout}.ts
// and server/{ratings,stats,me}.ts. This page describes, but never changes, the rules.
export function AboutPage() {
  useDocumentTitle('About & scoring — Oche')

  useEffect(() => {
    // The app renders after the browser's initial fragment scroll on a direct visit.
    const id = window.location.hash.slice(1)
    if (sections.some(([section]) => section === id)) document.getElementById(id)?.scrollIntoView()
  }, [])

  return (
    <article className="page prose about-page">
      <header className="about-intro">
        <span className="eyebrow"><Info size={14} aria-hidden="true" /> OCHE ONLINE · THE NUMBERS EXPLAINED</span>
        <h1>About & scoring</h1>
        <p className="lead">From your first dart to your room rating. Here’s how Oche turns the darts you enter into scores, statistics and leaderboards.</p>
        <div className="about-at-a-glance">
          <div><Calculator size={20} aria-hidden="true" /><strong>Every dart counts</strong><span>Misses and bust darts stay in your averages.</span></div>
          <div><Trophy size={20} aria-hidden="true" /><strong>1000 to start</strong><span>A separate Elo rating in every room.</span></div>
          <div><BarChart3 size={20} aria-hidden="true" /><strong>Save to make it count</strong><span>Only saved results update room and career stats.</span></div>
        </div>
      </header>

      <nav className="about-contents" aria-label="On this page">
        <strong>ON THIS PAGE</strong>
        <ol>{sections.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ol>
      </nav>

      <section aria-labelledby="what-counts">
        <h2 id="what-counts" tabIndex={-1}>01 · What counts</h2>
        <p>Online Oche is a casual, self-reported darts scorer for you and your crew—not a verified competition ranking. The numbers describe the darts entered, so record each dart accurately.</p>
        <ul>
          <li><b>Room and career statistics:</b> a room match counts after the final leg is won and someone selects <b>Save result</b>. Live statistics include the leg in progress, but unfinished or abandoned matches do not enter the leaderboard. On the live scorecard, AVG is match-wide while DARTS is for the current leg and resets each leg.</li>
          <li><b>Quick game:</b> the local scorer does not save a room result or affect online ratings or career statistics.</li>
          <li><b>Guests:</b> their darts and results appear in match history and match statistics, but guests have no Elo rating, ranked leaderboard entry or account career stats. Signing in later creates a separate account identity; it does not convert old guest results.</li>
          <li><b>Mixed formats:</b> 101, 301, 501 and 701, all in/out rules and all match lengths share the same room leaderboard. There is no format adjustment—agree on a format if you want a consistent league.</li>
          <li><b>Corrections:</b> use Undo, restart or visit rewind before saving. Saved matches cannot be edited. If a host deletes a mistaken result, its statistics disappear and the room’s ratings are replayed from the remaining results in completion order.</li>
        </ul>
      </section>

      <section aria-labelledby="scoring">
        <h2 id="scoring" tabIndex={-1}>02 · Scoring & match rules</h2>
        <p>Each player starts a leg on the chosen score: <b>101, 301, 501 or 701</b>. Take turns throwing up to three darts (a <b>visit</b>), subtracting scoring darts from your remaining total. Reach exactly zero under the chosen out rule to win the leg.</p>
        <dl className="about-definitions">
          <div><dt>Singles, doubles & trebles</dt><dd>A single scores the segment number (1–20), a double twice it, and a treble three times it. Outer bull scores 25; inner bull scores 50 and counts as a double. A miss scores zero.</dd></div>
          <div><dt>Single in / double in</dt><dd>Single in allows scoring immediately. Double in requires a double or inner bull to open each leg; that opening dart scores too. Earlier darts score zero but still count as darts thrown.</dd></div>
          <div><dt>Single out / double out</dt><dd>Single out allows any dart that reaches exactly zero, including doubles and trebles. Double out requires the final dart to be a double or inner bull.</dd></div>
          <div><dt>Busts</dt><dd>Going below zero is a bust. With double out, leaving 1 or reaching zero without a double is also a bust. The visit ends immediately, scores zero and restores the score and double-in status from the start of the visit. Only darts actually recorded up to and including the bust count—not an automatic three darts.</dd></div>
          <div><dt>Legs, matches & placing</dt><dd>Online matches have 2–8 players and are first to 1–11 legs. The starting player rotates each leg. The first player to reach the leg target wins the match and places first; everyone else is placed by legs won. Equal leg totals share a place (for example, 1st, 2nd, 2nd, 4th).</dd></div>
        </dl>
        <aside className="about-example">
          <strong>Enter darts, not visit totals</strong>
          <p>Use <code>T20 20 D10</code> for a 100-point, three-dart visit. <code>36</code> is treated as one dart worth 36, not a visit total, and does not identify a double—use <code>D18</code> when the ring matters. <code>BULL</code> or <code>50</code> identifies inner bull. <code>MISS</code>, <code>0</code> or empty Enter records a miss. Recorded matches reject impossible single-dart scores.</p>
          <p>On 40 with double out, <code>20 20</code> busts on the second dart: the score returns to 40, with zero points and two darts added to your statistics.</p>
        </aside>
      </section>

      <section aria-labelledby="statistics">
        <h2 id="statistics" tabIndex={-1}>03 · Averages & statistics</h2>
        <h3>3-dart average · AVG</h3>
        <p>How many points you score per three darts. This uses credited points, not the sum of everything hit before a bust. Misses, darts before doubling in and darts in bust visits count in the denominator; bust visits contribute zero points.</p>
        <p className="about-formula">3-dart average = 3 × total points ÷ darts thrown</p>
        <p>Example: a 501-point leg won in 24 darts gives <b>3 × 501 ÷ 24 = 62.6</b> when displayed. Winning on dart one or two of a visit counts only those darts, not a full three.</p>

        <h3>First 9 average</h3>
        <p>The same three-dart average, but using only <b>your first nine darts in each leg</b>. If you throw fewer than nine, only the darts actually thrown are used. Misses and double-in failures still count, and points from a bust visit are zero even if part of that visit falls within the first nine.</p>
        <p className="about-formula">First 9 = 3 × points in first-nine darts ÷ first-nine darts thrown</p>
        <p>Across legs or matches, Oche adds the points and darts first, then divides. It does <b>not</b> average the displayed averages. For example, 180 points in 9 darts plus 60 in 6 gives <b>3 × 240 ÷ 15 = 48.0</b>, not 45.0.</p>

        <h3>Checkout rate · CO %</h3>
        <p>A checkout is a leg won. An attempt is a dart thrown when you were <b>already opened and could legally finish with one dart</b>, checked immediately before that dart. It measures opportunity, not where you intended to aim.</p>
        <p className="about-formula">Checkout % = 100 × legs won ÷ checkout attempts</p>
        <ul>
          <li><b>Double out:</b> one-dart finishes are even scores from 2 to 40, plus 50.</li>
          <li><b>Single out:</b> any remaining score hittable with one physical dart qualifies: singles 1–20, doubles 2–40, trebles 3–60, 25 and 50.</li>
          <li>Misses or bust darts on those scores are attempts too. Setup darts from scores that cannot be finished in one dart are not. A double-in opening dart is not an attempt because you were not yet opened before throwing it.</li>
        </ul>
        <aside className="about-example">
          <strong>One finish, two attempts</strong>
          <p>With double out and 60 remaining, <code>20 MISS D20</code> has two attempts: the miss and D20 were both thrown from 40. The opening 20 was thrown from 60, which cannot be finished with one double. That leg contributes <b>1 ÷ 2 = 50.0%</b>.</p>
        </aside>
        <p>Room and career checkout rates use total checkouts divided by total attempts, not an average of match percentages. With no attempts, the rate is shown as <b>—</b>.</p>

        <h3>Records & counts</h3>
        <dl className="about-definitions">
          <div><dt>W–L & win rate</dt><dd>W counts match wins; L counts every other completed match, including second place in multiplayer. Win % = 100 × match wins ÷ matches played. This is separate from legs won.</dd></div>
          <div><dt>Legs won / played</dt><dd>Legs won is your checkout count. Legs played counts every completed leg you participated in, including a leg an opponent finished before you got a turn.</dd></div>
          <div><dt>180s / 140+ / 100+</dt><dd>These are separate visit buckets: exactly 180, 140–179, and 100–139 respectively. A 180 does not also count as a 140+ or 100+. Busts score zero and do not enter these buckets.</dd></div>
          <div><dt>Highest checkout · HIGH OUT</dt><dd>The largest score remaining at the start of a visit in which you won a leg. A T20–D20 finish from 100 is a 100 checkout, not 40.</dd></div>
          <div><dt>Best leg</dt><dd>The fewest darts you personally threw to win a leg, including misses, bust darts and darts before doubling in. Lower is better; legs you lost do not qualify.</dd></div>
          <div><dt>Darts & visits</dt><dd>Darts thrown counts recorded darts; a visit is one turn, which can end early with a bust or checkout. Neither adds imaginary darts after that turn has ended.</dd></div>
        </dl>
        <p>Averages and checkout percentages display one decimal place; win percentages display whole percentages. Sorting and best-stat highlights use the underlying values, so two stats that look equal after rounding can still sort differently. <b>—</b> means there is no applicable value yet (for example, no winning leg for best leg), rather than a zero performance.</p>
      </section>

      <section aria-labelledby="ratings">
        <h2 id="ratings" tabIndex={-1}>04 · Room ratings (Elo)</h2>
        <p>Every account player starts at <b>1000 in each room</b>. Ratings estimate relative results within that room, not a global skill level. Only saved matches with at least two account players can change ratings. Guests are excluded from the pair comparisons; a match with only one account player leaves that player’s rating unchanged, but still counts toward their statistics.</p>
        <p>In multiplayer, Oche compares every pair of account players by final placing. Finishing ahead scores <b>1</b>, tying scores <b>½</b>, and finishing behind scores <b>0</b>. You can gain rating without winning the whole match. Guests can win matches and affect leg totals, but they are never rated opponents.</p>

        <h3>The formula</h3>
        <p>For player <b>i</b> against player <b>j</b>, R is the rating before the match, E is the expected pair score, and S is the actual pair score (1, ½ or 0). With <b>n</b> account players and <b>K = 32</b>:</p>
        <div className="about-formulas" aria-label="Elo formulas">
          <p className="about-formula">E<sub>ij</sub> = 1 ÷ (1 + 10<sup>(Rⱼ − Rᵢ) / 400</sup>)</p>
          <p className="about-formula">ΔR<sub>i</sub> = [32 ÷ (n − 1)] × <span>∑<sub>j ≠ i</sub> (S<sub>ij</sub> − E<sub>ij</sub>)</span></p>
          <p className="about-formula">New rating = old rating + ΔR</p>
        </div>
        <p>In words: add up how much better or worse you placed against each opponent than your ratings predicted, then multiply by 32 divided by the number of ranked opponents. All updates use the <b>same pre-match ratings</b>, so player order does not change the calculation.</p>
        <div className="about-example-grid">
          <aside className="about-example"><strong>Two equal players</strong><p>Both start at 1000, so each has an expected pair score of 0.5. The winner gains 32 × (1 − 0.5) = <b>16</b>; the loser loses 16. New ratings: <b>1016 and 984</b>.</p></aside>
          <aside className="about-example"><strong>Three equal players</strong><p>All start at 1000 and finish 1st, 2nd and 3rd. Each comparison is scaled by 32 ÷ 2 = 16. Changes are <b>+16, 0, −16</b>. If second and third tie instead, the changes are <b>+16, −8, −8</b>.</p></aside>
        </div>
        <p>Beating a stronger opponent earns more than beating a weaker one. Average, checkout rate, score margin and match length do not directly enter Elo; only ratings and final placings do. K stays 32—there is no extra new-player multiplier or inactivity decay.</p>
        <p>Ratings are stored at full precision and rounded to whole numbers for display. The displayed change is the rounded after-rating minus the rounded before-rating. The small change beside a leaderboard rating is from that player’s latest saved match, <b>not</b> their total change over the selected period.</p>
      </section>

      <section aria-labelledby="leaderboards">
        <h2 id="leaderboards" tabIndex={-1}>05 · Reading the leaderboard</h2>
        <dl className="about-definitions">
          <div><dt>All time / 30 days / 7 days</dt><dd>The leaderboard lists current account members of the room, not guests or former members. Former members’ retained results still influence rating history. The time filter uses the match’s saved completion time. The 7- and 30-day windows roll back from the current time; they are not calendar weeks or months. Counts, averages, records and form use results within the selected window. Ratings always use the room’s full history and do not reset with the filter.</dd></div>
          <div><dt>Sorting & row numbers</dt><dd>Players with matches in the selected period appear first; those without appear below, unnumbered. The # column is the row position for the chosen sort, not a permanent rank. Higher is better except for best leg, where fewer darts wins; missing values sort last. Equal values fall back to rating, then the underlying order of wins in the period, name and ID.</dd></div>
          <div><dt>Room rank on home / My stats</dt><dd>This compares your rounded rating with current account members who have a saved result in that room. Rank = 1 + the number of those members with a higher rating. Equal ratings share a rank; a player without results has no rank. This can differ from the leaderboard’s sequential row numbers.</dd></div>
          <div><dt>Form</dt><dd>Up to five latest match results within the selected period, newest first. W means you won the match; L means you did not, regardless of your Elo change.</dd></div>
          <div><dt>Highlights & green cells</dt><dd>Leaderboard highlights pick the best available nonzero value among players active in the selected period; a tie shows the first in the underlying rating/wins/name/ID order. Match-stat tables highlight all players tied for the best available value in a highlighted row. Neither awards bonus rating.</dd></div>
          <div><dt>Rating history & head to head</dt><dd>Player details use all-time room results. The chart appears after two saved results, starts at 1000 and plots the rounded rating after each match, oldest to newest. Matches are evenly spaced, not spaced by elapsed time. Head-to-head wins and losses compare your placing against each account opponent, including multiplayer matches. Equal placings add neither a win nor a loss, and guests are excluded.</dd></div>
          <div><dt>My stats · Career</dt><dd>Career totals combine your saved account results across rooms, including retained results from rooms you have left. They sum points, darts and checkout counts before calculating rates. Room ratings stay separate—there is no combined career Elo.</dd></div>
        </dl>
      </section>

      <section aria-labelledby="checkouts">
        <h2 id="checkouts" tabIndex={-1}>06 · Checkout suggestions</h2>
        <p>Checkout routes are suggestions, not predictions of your accuracy. They use the remaining score, darts available and in/out rules. A finish must open on a double if needed, and end on a double when double out is enabled.</p>
        <p>The standard route uses a preferred checkout table when a listed double-out route fits. Otherwise it searches legal combinations, starting with the fewest darts and using a fixed dart preference to choose between routes. Single-out games prefer an obvious single or outer bull when that finishes immediately.</p>
        <p>The <b>easier route</b> searches the available combinations with a different cost: 10 per dart, plus 100 for a treble, 70 for a double or inner bull that is not required to open or finish, and 15 for outer bull. A small extra cost favors larger scoring targets below 20. The lowest-cost route wins, so it may use more darts to avoid a treble.</p>
        <p>No legal route within the available darts means no checkout suggestion. These hints do not affect your score, rating or checkout-attempt count; the darts you actually enter do.</p>
      </section>

      <aside className="about-source">
        <strong>Open calculations, no hidden bonuses.</strong>
        <p>You can inspect the implementation on GitHub: <a href="https://github.com/ricsam/dart-scorer/tree/main/src/game" target="_blank" rel="noreferrer">scoring & statistics</a>, <a href="https://github.com/ricsam/dart-scorer/blob/main/server/ratings.ts" target="_blank" rel="noreferrer">Elo ratings</a> and <a href="https://github.com/ricsam/dart-scorer/blob/main/server/stats.ts" target="_blank" rel="noreferrer">leaderboard totals</a>.</p>
      </aside>
    </article>
  )
}
