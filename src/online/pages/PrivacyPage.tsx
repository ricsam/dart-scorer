import { useDocumentTitle } from '../hooks'
import { Link } from '../router'

export function PrivacyPage() {
  useDocumentTitle('Privacy — Oche')
  return (
    <article className="page prose">
      <span className="eyebrow">OCHE ONLINE</span>
      <h1>Privacy</h1>
      <p className="lead">Oche is an open-source darts scorer. The online edition stores only what it needs to run rooms and leaderboards for you and the people you play with.</p>

      <h2>What we store</h2>
      <ul>
        <li><b>Your Google account basics:</b> the account identifier, name, email address and profile picture URL that Google shares when you sign in. Your display name can be changed on your profile.</li>
        <li><b>Guest players:</b> a display name, room membership and match participation, whether added by a friend or joined from an invite. A session cookie connects a self-joining guest to their browser; no Google account or email is needed.</li>
        <li><b>What you create:</b> rooms, room memberships, matches, every dart entered in them, and the statistics and ratings derived from them.</li>
        <li><b>A session cookie</b> that keeps you signed in. The theme preference lives only in your browser’s local storage.</li>
      </ul>

      <h2>Who can see it</h2>
      <p>Your display name, picture, matches and statistics are visible to members of the rooms you join. Your email address is only shown to you. Invite links let anyone who has them see a room’s name, host, player count and unclaimed guest names before joining. They can join as a new guest or connect to an unclaimed guest slot. Share invites only with people you trust.</p>

      <h2>What we don’t do</h2>
      <p>Oche includes no ads or analytics scripts. The hosting provider processes requests and operational logs; Google serves sign-in, profile images and fonts. Google sign-in only requests your basic profile (<code>openid email profile</code>); Oche never sees your password and cannot access anything else in your Google account.</p>

      <h2>Removing your data</h2>
      <p>You can leave rooms at any time, and room hosts can delete their rooms along with all of their matches. For an account removal request, contact the operator through the <a href="https://github.com/ricsam" target="_blank" rel="noreferrer">maintainer’s GitHub profile</a>. Do not post email addresses or other personal information in public issues. Account deletion is currently handled by the operator rather than in the app.</p>

      <h2>No account needed to keep score</h2>
      <p>The <Link to="/play">standalone scorer</Link> works without signing in and keeps everything on your device.</p>

      <p className="muted-note">The source code is available at <a href="https://github.com/ricsam/dart-scorer" target="_blank" rel="noreferrer">github.com/ricsam/dart-scorer</a>.</p>
    </article>
  )
}
