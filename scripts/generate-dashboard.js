/**
 * generate-dashboard.js
 * Fetches live GitHub stats (top repos, top languages, contributions) via the
 * GraphQL API and renders a dark, glowing, animated SVG dashboard.
 *
 * Env vars required:
 *   GH_USERNAME  - the GitHub username to build the dashboard for
 *   GH_TOKEN     - a token with at least `public_repo`/`read:user` access
 */

const fs = require("fs");
const path = require("path");

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GH_TOKEN;
const OUTPUT_PATH = process.env.OUTPUT_PATH || "assets/dashboard.svg";

if (!USERNAME || !TOKEN) {
  console.error("Missing GH_USERNAME or GH_TOKEN env vars.");
  process.exit(1);
}

const QUERY = /* GraphQL */ `
  query ($login: String!) {
    user(login: $login) {
      name
      login
      followers {
        totalCount
      }
      contributionsCollection {
        contributionCalendar {
          totalContributions
        }
        totalPullRequestContributions
        totalIssueContributions
      }
      repositories(
        first: 100
        ownerAffiliations: OWNER
        isFork: false
        privacy: PUBLIC
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        totalCount
        nodes {
          name
          stargazerCount
          forkCount
          primaryLanguage {
            name
            color
          }
          languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
    }
  }
`;

async function fetchStats() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data.user;
}

async function fetchAvatarBase64(login) {
  try {
    const res = await fetch(`https://github.com/${login}.png?size=200`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/png";
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function aggregate(user) {
  const repos = user.repositories.nodes;

  const totalStars = repos.reduce((sum, r) => sum + r.stargazerCount, 0);

  const topRepos = [...repos]
    .sort((a, b) => b.stargazerCount - a.stargazerCount)
    .slice(0, 5)
    .map((r) => ({
      name: r.name,
      stars: r.stargazerCount,
      forks: r.forkCount,
      language: r.primaryLanguage?.name || "Other",
      color: r.primaryLanguage?.color || "#8b949e",
    }));

  const langTotals = {};
  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      const name = edge.node.name;
      langTotals[name] = langTotals[name] || { size: 0, color: edge.node.color || "#8b949e" };
      langTotals[name].size += edge.size;
    }
  }
  const totalSize = Object.values(langTotals).reduce((s, l) => s + l.size, 0) || 1;
  const topLanguages = Object.entries(langTotals)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 6)
    .map(([name, { size, color }]) => ({
      name,
      color,
      percent: Math.round((size / totalSize) * 1000) / 10,
    }));

  const contributions =
    user.contributionsCollection.contributionCalendar.totalContributions +
    user.contributionsCollection.totalPullRequestContributions +
    user.contributionsCollection.totalIssueContributions;

  return {
    name: user.name || user.login,
    login: user.login,
    followers: user.followers.totalCount,
    totalStars,
    totalRepos: user.repositories.totalCount,
    contributions,
    topRepos,
    topLanguages,
  };
}

function esc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderSVG(data) {
  const W = 960;
  const H = 560;
  const PAD = 28;
  const GAP = 20;

  const HERO_W = 272;
  const HERO_X = PAD;
  const HERO_Y = PAD;
  const HERO_H = H - PAD * 2;

  const RIGHT_X = HERO_X + HERO_W + GAP;
  const RIGHT_W = W - RIGHT_X - PAD;
  const LANG_H = 232;
  const LANG_Y = PAD;
  const REPO_Y = LANG_Y + LANG_H + GAP;
  const REPO_H = HERO_H - LANG_H - GAP;

  // ---------- Hero card content ----------
  const avatarR = 38;
  const avatarCx = HERO_X + HERO_W / 2;
  const avatarCy = HERO_Y + 66;

  const avatarSVG = data.avatarDataUri
    ? `
      <clipPath id="avatarClip"><circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}"/></clipPath>
      <image href="${data.avatarDataUri}" x="${avatarCx - avatarR}" y="${avatarCy - avatarR}"
             width="${avatarR * 2}" height="${avatarR * 2}" clip-path="url(#avatarClip)"/>`
    : `<circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" fill="#1c2431"/>
       <text x="${avatarCx}" y="${avatarCy + 8}" text-anchor="middle" class="avatar-fallback">${esc(
         (data.name || "?").slice(0, 1).toUpperCase()
       )}</text>`;

  const statRows = [
    { label: "Followers", value: data.followers },
    { label: "Total stars", value: data.totalStars },
    { label: "Public repos", value: data.totalRepos },
    { label: "Contributions / yr", value: data.contributions },
  ];
  const statsTop = avatarCy + avatarR + 50;
  const rowH = 58;
  const heroStatsSVG = statRows
    .map((s, i) => {
      const y = statsTop + i * rowH;
      return `
      <g transform="translate(${HERO_X + 22}, ${y})">
        <line x1="0" y1="${rowH - 20}" x2="${HERO_W - 44}" y2="${rowH - 20}" stroke="#232a36" stroke-width="1"/>
        <text x="0" y="0" class="hero-stat-label">${esc(s.label)}</text>
        <text x="${HERO_W - 44}" y="0" text-anchor="end" class="hero-stat-value" filter="url(#softGlow)">${s.value.toLocaleString()}</text>
      </g>`;
    })
    .join("");

  // ---------- Language bars ----------
  const langRowH = (LANG_H - 60) / Math.max(data.topLanguages.length, 1);
  const rowUsableW = RIGHT_W - 44;
  const labelReserve = 96;
  const percentReserve = 42;
  const barX = labelReserve;
  const maxBarWidth = rowUsableW - labelReserve - percentReserve;
  const langBarsSVG = data.topLanguages
    .map((lang, i) => {
      const y = LANG_Y + 54 + i * langRowH;
      const barWidth = Math.max(6, (lang.percent / 100) * maxBarWidth);
      const gid = `langGrad${i}`;
      return `
      <g transform="translate(${RIGHT_X + 22}, ${y})">
        <text x="0" y="0" class="lang-label">${esc(lang.name)}</text>
        <text x="${rowUsableW}" y="0" text-anchor="end" class="lang-percent">${lang.percent}%</text>
        <rect x="${barX}" y="-9" width="${maxBarWidth}" height="7" rx="3.5" fill="#1a2029"/>
        <defs>
          <linearGradient id="${gid}" gradientUnits="objectBoundingBox" x1="-1" y1="0" x2="0" y2="0" spreadMethod="reflect">
            <stop offset="0%" stop-color="${lang.color}"/>
            <stop offset="50%" stop-color="#ffffff"/>
            <stop offset="100%" stop-color="${lang.color}"/>
            <animate attributeName="x1" values="-1;1" dur="3.2s" begin="${(i * 0.22).toFixed(2)}s" repeatCount="indefinite"/>
            <animate attributeName="x2" values="0;2" dur="3.2s" begin="${(i * 0.22).toFixed(2)}s" repeatCount="indefinite"/>
          </linearGradient>
        </defs>
        <rect x="${barX}" y="-9" width="${barWidth}" height="7" rx="3.5" fill="url(#${gid})"/>
      </g>`;
    })
    .join("");

  // ---------- Repo rows ----------
  const repoRowH = (REPO_H - 60) / Math.max(data.topRepos.length, 1);
  const repoRowsSVG = data.topRepos
    .map((repo, i) => {
      const y = REPO_Y + 54 + i * repoRowH;
      return `
      <g transform="translate(${RIGHT_X + 22}, ${y})">
        <circle cx="4" cy="-5" r="4" fill="${repo.color}" class="dot-pulse" style="animation-delay:${(i * 0.3).toFixed(2)}s"/>
        <text x="16" y="0" class="repo-name">${esc(repo.name)}</text>
        <text x="${RIGHT_W - 44}" y="0" text-anchor="end" class="repo-stars">&#9733; ${repo.stars.toLocaleString()}</text>
      </g>`;
    })
    .join("");

  const cardSweep = (x, y, w, h, delay) => `
    <clipPath id="sweep-${x}-${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18"/></clipPath>
    <g clip-path="url(#sweep-${x}-${y})">
      <rect x="${x - 120}" y="${y}" width="120" height="${h}" fill="url(#sweepGrad)" class="card-sweep" style="animation-delay:${delay}s; --sweep-dist:${w + 200}px"/>
    </g>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#080a0e"/>
      <stop offset="100%" stop-color="#0d1016"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="ringGrad" gradientUnits="userSpaceOnUse" x1="${avatarCx - avatarR - 6}" y1="${avatarCy - avatarR - 6}" x2="${avatarCx + avatarR + 6}" y2="${avatarCy + avatarR + 6}">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="50%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#818cf8"/>
      <animateTransform attributeName="gradientTransform" type="rotate"
        from="0 ${avatarCx} ${avatarCy}" to="360 ${avatarCx} ${avatarCy}" dur="6s" repeatCount="indefinite"/>
    </linearGradient>
    <radialGradient id="blobIndigo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blobCyan" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
    <pattern id="dotGrid" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="1.2" cy="1.2" r="1.2" fill="#ffffff" fill-opacity="0.045"/>
    </pattern>
    <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="1.8" result="blur">
        <animate attributeName="stdDeviation" values="1;2.4;1" dur="3.4s" repeatCount="indefinite"/>
      </feGaussianBlur>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="bigBlur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="55"/>
    </filter>
    <clipPath id="cardClip"><rect x="0" y="0" width="${W}" height="${H}" rx="20"/></clipPath>
  </defs>

  <style>
    text { font-family: -apple-system, "Segoe UI", Ubuntu, Roboto, sans-serif; }
    .mono { font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace; }
    .title { fill: #f0f3f8; font-size: 20px; font-weight: 700; }
    .subtitle { fill: #6b7684; font-size: 12.5px; }
    .avatar-fallback { fill: #f0f3f8; font-size: 28px; font-weight: 700; font-family: -apple-system, sans-serif; }
    .section-title { fill: #c9d1d9; font-size: 13px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; }
    .hero-stat-label { fill: #7c8798; font-size: 12px; }
    .hero-stat-value { fill: url(#accentGrad); font-size: 19px; font-weight: 800; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
    .lang-label { fill: #d5dbe3; font-size: 12.5px; font-weight: 600; }
    .lang-percent { fill: #7c8798; font-size: 11.5px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
    .repo-name { fill: #d5dbe3; font-size: 12.5px; font-weight: 600; }
    .repo-stars { fill: #e3b341; font-size: 12.5px; font-weight: 600; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
    .footer { fill: #4b5563; font-size: 11px; }
    .glass { fill: #ffffff; fill-opacity: 0.025; stroke: #ffffff; stroke-opacity: 0.08; stroke-width: 1; }

    @keyframes sweepMove {
      0% { transform: translateX(0); }
      100% { transform: translateX(var(--sweep-dist)); }
    }
    @keyframes dotPulse {
      0%, 100% { opacity: 0.55; r: 3.4px; }
      50% { opacity: 1; r: 4.6px; }
    }
    @keyframes drift1 { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(36px, 22px); } }
    @keyframes drift2 { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(-30px, -18px); } }
    @keyframes borderGlow { 0%, 100% { stroke-opacity: 0.35; } 50% { stroke-opacity: 0.75; } }

    .card-sweep { animation: sweepMove 4.5s linear infinite; }
    .dot-pulse { animation: dotPulse 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
    .blob-a { animation: drift1 10s ease-in-out infinite; }
    .blob-b { animation: drift2 12s ease-in-out infinite; }
    .glow-border { animation: borderGlow 3s ease-in-out infinite; }
  </style>

  <rect x="0" y="0" width="${W}" height="${H}" rx="20" fill="url(#bgGrad)"/>
  <rect x="0" y="0" width="${W}" height="${H}" rx="20" fill="url(#dotGrid)"/>

  <g clip-path="url(#cardClip)">
    <circle class="blob-a" cx="${HERO_X + 100}" cy="${HERO_Y + 40}" r="150" fill="url(#blobIndigo)" filter="url(#bigBlur)"/>
    <circle class="blob-b" cx="${W - 120}" cy="${H - 80}" r="170" fill="url(#blobCyan)" filter="url(#bigBlur)"/>
  </g>

  <rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="19" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1.5"/>

  <!-- Hero card -->
  <rect x="${HERO_X}" y="${HERO_Y}" width="${HERO_W}" height="${HERO_H}" rx="18" class="glass"/>
  <rect x="${HERO_X}" y="${HERO_Y}" width="${HERO_W}" height="${HERO_H}" rx="18" fill="none" stroke="url(#accentGrad)" stroke-opacity="0.4" stroke-width="1" class="glow-border"/>
  ${cardSweep(HERO_X, HERO_Y, HERO_W, HERO_H, "0")}

  <circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR + 4}" fill="none" stroke="url(#ringGrad)" stroke-width="2.5"/>
  ${avatarSVG}

  <text x="${HERO_X + HERO_W / 2}" y="${avatarCy + avatarR + 26}" text-anchor="middle" class="title">${esc(data.name)}</text>
  <text x="${HERO_X + HERO_W / 2}" y="${avatarCy + avatarR + 44}" text-anchor="middle" class="subtitle">@${esc(data.login)}</text>

  ${heroStatsSVG}

  <!-- Languages card -->
  <rect x="${RIGHT_X}" y="${LANG_Y}" width="${RIGHT_W}" height="${LANG_H}" rx="18" class="glass"/>
  <rect x="${RIGHT_X}" y="${LANG_Y}" width="${RIGHT_W}" height="${LANG_H}" rx="18" fill="none" stroke="url(#accentGrad)" stroke-opacity="0.4" stroke-width="1" class="glow-border"/>
  ${cardSweep(RIGHT_X, LANG_Y, RIGHT_W, LANG_H, "1.5")}
  <text x="${RIGHT_X + 22}" y="${LANG_Y + 32}" class="section-title">Top Languages</text>
  ${langBarsSVG}

  <!-- Repositories card -->
  <rect x="${RIGHT_X}" y="${REPO_Y}" width="${RIGHT_W}" height="${REPO_H}" rx="18" class="glass"/>
  <rect x="${RIGHT_X}" y="${REPO_Y}" width="${RIGHT_W}" height="${REPO_H}" rx="18" fill="none" stroke="url(#accentGrad)" stroke-opacity="0.4" stroke-width="1" class="glow-border"/>
  ${cardSweep(RIGHT_X, REPO_Y, RIGHT_W, REPO_H, "3")}
  <text x="${RIGHT_X + 22}" y="${REPO_Y + 32}" class="section-title">Top Repositories</text>
  ${repoRowsSVG}

  <text x="${W - PAD}" y="${H - 12}" text-anchor="end" class="footer">auto-updated via GitHub Actions</text>
</svg>`;
}

async function main() {
  console.log(`Fetching stats for ${USERNAME}...`);
  const [user, avatarDataUri] = await Promise.all([fetchStats(), fetchAvatarBase64(USERNAME)]);
  const data = { ...aggregate(user), avatarDataUri };
  const svg = renderSVG(data);

  const outPath = path.join(process.cwd(), OUTPUT_PATH);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, svg, "utf8");
  console.log(`Dashboard written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
