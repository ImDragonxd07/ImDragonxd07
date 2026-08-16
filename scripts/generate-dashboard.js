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
  const W = 920;
  const H = 480;
  const PAD = 32;

  const statBoxes = [
    { label: "Followers", value: data.followers },
    { label: "Total Stars", value: data.totalStars },
    { label: "Public Repos", value: data.totalRepos },
    { label: "Contributions / yr", value: data.contributions },
  ];

  const statAreaW = W - PAD * 2;
  const statGap = 16;
  const statBoxWidth = (statAreaW - statGap * 3) / statBoxes.length;
  const STAT_Y = 100;
  const STAT_H = 82;

  const statBoxesSVG = statBoxes
    .map((s, i) => {
      const x = PAD + i * (statBoxWidth + statGap);
      const delay = (i * 0.4).toFixed(2);
      return `
      <g transform="translate(${x}, ${STAT_Y})">
        <clipPath id="statclip${i}"><rect x="0" y="0" width="${statBoxWidth}" height="${STAT_H}" rx="14"/></clipPath>
        <rect x="0" y="0" width="${statBoxWidth}" height="${STAT_H}" rx="14"
              fill="url(#cardGrad)" stroke="#30363d" stroke-width="1" class="stat-breathe" style="animation-delay:${delay}s"/>
        <g clip-path="url(#statclip${i})">
          <rect x="-70" y="0" width="70" height="${STAT_H}" fill="url(#sweepGrad)"
                class="card-sweep" style="animation-delay:${(i * 0.6).toFixed(2)}s"/>
        </g>
        <text x="${statBoxWidth / 2}" y="36" text-anchor="middle" class="stat-value" filter="url(#softGlow)">${s.value.toLocaleString()}</text>
        <text x="${statBoxWidth / 2}" y="60" text-anchor="middle" class="stat-label">${esc(s.label)}</text>
      </g>`;
    })
    .join("");

  const SECTION_Y = 232;
  const ROW_START_Y = 268;
  const LANG_ROW_H = 34;
  const REPO_ROW_H = 38;
  const DIVIDER_X = PAD + 430;

  const maxBarWidth = 300;
  const langBarsSVG = data.topLanguages
    .map((lang, i) => {
      const y = ROW_START_Y + i * LANG_ROW_H;
      const barWidth = Math.max(8, (lang.percent / 100) * maxBarWidth);
      const gid = `langGrad${i}`;
      return `
      <g transform="translate(${PAD}, ${y})">
        <circle cx="4" cy="-4" r="4" fill="${lang.color}"/>
        <text x="14" y="0" class="lang-label">${esc(lang.name)}</text>
        <text x="${maxBarWidth}" y="0" text-anchor="end" class="lang-percent">${lang.percent}%</text>
        <rect x="0" y="8" width="${maxBarWidth}" height="8" rx="4" fill="#1c2129"/>
        <defs>
          <linearGradient id="${gid}" gradientUnits="objectBoundingBox" x1="-1" y1="0" x2="0" y2="0" spreadMethod="reflect">
            <stop offset="0%" stop-color="${lang.color}"/>
            <stop offset="50%" stop-color="#ffffff"/>
            <stop offset="100%" stop-color="${lang.color}"/>
            <animate attributeName="x1" values="-1;1" dur="3s" begin="${(i * 0.25).toFixed(2)}s" repeatCount="indefinite"/>
            <animate attributeName="x2" values="0;2" dur="3s" begin="${(i * 0.25).toFixed(2)}s" repeatCount="indefinite"/>
          </linearGradient>
        </defs>
        <rect x="0" y="8" width="${barWidth}" height="8" rx="4" fill="url(#${gid})"/>
      </g>`;
    })
    .join("");

  const repoRowsSVG = data.topRepos
    .map((repo, i) => {
      const y = ROW_START_Y + i * REPO_ROW_H;
      return `
      <g transform="translate(${DIVIDER_X + 28}, ${y})">
        <circle cx="4" cy="-4" r="4" fill="${repo.color}" class="dot-pulse" style="animation-delay:${(i * 0.3).toFixed(2)}s"/>
        <text x="16" y="0" class="repo-name">${esc(repo.name)}</text>
        <text x="368" y="0" text-anchor="end" class="repo-stars">&#9733; ${repo.stars.toLocaleString()}</text>
      </g>`;
    })
    .join("");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0e14"/>
      <stop offset="100%" stop-color="#12161d"/>
    </linearGradient>
    <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#171c25"/>
      <stop offset="100%" stop-color="#10141b"/>
    </linearGradient>
    <linearGradient id="titleGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#79c0ff"/>
      <stop offset="50%" stop-color="#b98cff"/>
      <stop offset="100%" stop-color="#56d364"/>
    </linearGradient>
    <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="borderGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${H}">
      <stop offset="0%" stop-color="#58a6ff"/>
      <stop offset="33%" stop-color="#b98cff"/>
      <stop offset="66%" stop-color="#56d364"/>
      <stop offset="100%" stop-color="#58a6ff"/>
      <animateTransform attributeName="gradientTransform" type="rotate"
        from="0 ${W / 2} ${H / 2}" to="360 ${W / 2} ${H / 2}" dur="10s" repeatCount="indefinite"/>
    </linearGradient>
    <radialGradient id="blobBlue" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1f6feb" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#1f6feb" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blobPurple" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#8957e5" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#8957e5" stop-opacity="0"/>
    </radialGradient>
    <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="2.6" result="blur">
        <animate attributeName="stdDeviation" values="1.6;3.4;1.6" dur="3.5s" repeatCount="indefinite"/>
      </feGaussianBlur>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="bigBlur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="45"/>
    </filter>
    <clipPath id="cardClip"><rect x="0" y="0" width="${W}" height="${H}" rx="18"/></clipPath>
  </defs>

  <style>
    text { font-family: -apple-system, "Segoe UI", Ubuntu, Roboto, sans-serif; }
    .title { fill: url(#titleGrad); font-size: 30px; font-weight: 800; }
    .subtitle { fill: #9aa4b2; font-size: 14px; }
    .section-title { fill: #e6edf3; font-size: 15px; font-weight: 700; letter-spacing: 0.6px; }
    .stat-label { fill: #9aa4b2; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
    .stat-value { fill: #79c0ff; font-size: 26px; font-weight: 800; }
    .lang-label { fill: #dbe2ea; font-size: 13px; font-weight: 600; }
    .lang-percent { fill: #9aa4b2; font-size: 12px; }
    .repo-name { fill: #dbe2ea; font-size: 13px; font-weight: 600; }
    .repo-stars { fill: #e3b341; font-size: 13px; font-weight: 600; }
    .footer { fill: #6b7684; font-size: 12px; }

    @keyframes breathe {
      0%, 100% { opacity: 0.85; }
      50% { opacity: 1; }
    }
    @keyframes sweep {
      0% { transform: translateX(0); }
      100% { transform: translateX(${statBoxWidth + 80}px); }
    }
    @keyframes dotPulse {
      0%, 100% { opacity: 0.55; r: 3.4px; }
      50% { opacity: 1; r: 4.6px; }
    }
    @keyframes drift1 {
      0%, 100% { transform: translate(0px, 0px); }
      50% { transform: translate(50px, 30px); }
    }
    @keyframes drift2 {
      0%, 100% { transform: translate(0px, 0px); }
      50% { transform: translate(-40px, -25px); }
    }

    .stat-breathe { animation: breathe 3.2s ease-in-out infinite; }
    .card-sweep { animation: sweep 2.6s linear infinite; }
    .dot-pulse { animation: dotPulse 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
    .blob-a { animation: drift1 9s ease-in-out infinite; }
    .blob-b { animation: drift2 11s ease-in-out infinite; }
  </style>

  <rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="url(#bgGrad)"/>

  <g clip-path="url(#cardClip)">
    <circle class="blob-a" cx="120" cy="90" r="160" fill="url(#blobBlue)" filter="url(#bigBlur)"/>
    <circle class="blob-b" cx="${W - 140}" cy="${H - 100}" r="180" fill="url(#blobPurple)" filter="url(#bigBlur)"/>
  </g>

  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="17" fill="none" stroke="url(#borderGrad)" stroke-width="2"/>

  <text x="${PAD}" y="48" class="title" filter="url(#softGlow)">${esc(data.name)}</text>
  <text x="${PAD}" y="72" class="subtitle">@${esc(data.login)} &#183; live GitHub dashboard</text>

  ${statBoxesSVG}

  <text x="${PAD}" y="${SECTION_Y}" class="section-title">TOP LANGUAGES</text>
  <text x="${DIVIDER_X + 28}" y="${SECTION_Y}" class="section-title">TOP REPOSITORIES</text>

  ${langBarsSVG}
  ${repoRowsSVG}

  <line x1="${DIVIDER_X}" y1="${SECTION_Y - 22}" x2="${DIVIDER_X}" y2="${H - 34}" stroke="#2a313c" stroke-width="1"/>
  <text x="${W / 2}" y="${H - 16}" text-anchor="middle" class="footer">updated automatically via GitHub Actions</text>
</svg>`;
}

async function main() {
  console.log(`Fetching stats for ${USERNAME}...`);
  const user = await fetchStats();
  const data = aggregate(user);
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
