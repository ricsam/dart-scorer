import { useDocumentTitle } from '../hooks'
import { Link } from '../router'

export function PrivacyPage() {
  useDocumentTitle('Privacy — Oche')
  return (
    <article className="page prose">
      <span className="eyebrow">OCHE ONLINE</span>
      <h1>Privacy</h1>
      <p className="lead">Oche is an open-source darts scorer. The online edition stores only what it needs to run lobbies, leagues and leaderboards for you and the people you play with.</p>

      <h2>What we store</h2>
      <ul>
        <li><b>Your Google account basics:</b> the account identifier, name, email address and profile picture URL that Google shares when you sign in. Your display name can be changed on your profile.</li>
        <li><b>Guest players:</b> a display name, league membership and match participation, whether added by a friend or joined from an invite. A session cookie connects a self-joining guest to their browser; no Google account or email is needed.</li>
        <li><b>What you create:</b> leagues, lobbies, matches, every dart entered in them, chat messages, lobby invitations, and the statistics and ratings derived from them. Your last lobby format is remembered for the next lobby.</li>
        <li><b>A session cookie</b> that keeps you signed in. The theme preference lives only in your browser’s local storage.</li>
      </ul>

      <h2>Who can see it</h2>
      <p>Your display name, picture, matches and statistics are visible to members of the leagues you join and to players in your lobbies. Whether you are connected is shown to players in your lobby and games. Your email address is only shown to you. Invite links let anyone who has them see a league’s name, host, player count and unclaimed guest names before joining, or a lobby’s players and format. Share invites only with people you trust.</p>
      <p>When you open a <b>public lobby</b>, signed-in players can see it with your name, picture and global rating, and can watch its games live. Lobby chat is visible only to its players. If you play <b>ranked</b> games, your name, picture, global rating and ranked record appear in the global rankings for signed-in players. League members and people you have played with can invite you to a lobby.</p>
      <p>Chat messages are kept for the lobby or match they belong to (the latest 200 per conversation) and removed with it. Lobbies close automatically after they sit idle.</p>

      <h2>What we don’t do</h2>
      <p>Oche includes no ads or analytics scripts. The hosting provider processes requests and operational logs; Google serves sign-in, profile images and fonts. Google sign-in only requests your basic profile (<code>openid email profile</code>); Oche never sees your password and cannot access anything else in your Google account.</p>

      <h2>Removing your data</h2>
      <p>You can leave leagues at any time, and league hosts can delete their leagues along with all of their matches. For an account removal request, contact the operator through the <a href="https://github.com/ricsam" target="_blank" rel="noreferrer">maintainer’s GitHub profile</a>. Do not post email addresses or other personal information in public issues. Account deletion is currently handled by the operator rather than in the app.</p>

      <h2>No account needed to keep score</h2>
      <p>The <Link to="/">standalone scorer</Link> on the start page works without signing in and keeps everything on your device.</p>

      <p className="muted-note">The source code is available at <a href="https://github.com/ricsam/dart-scorer" target="_blank" rel="noreferrer">github.com/ricsam/dart-scorer</a>.</p>
    </article>
  )
}
