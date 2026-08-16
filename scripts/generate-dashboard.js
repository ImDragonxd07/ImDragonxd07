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
  const W = 880;
  const H = 420;

  const statBoxes = [
    { label: "Followers", value: data.followers },
    { label: "Total Stars", value: data.totalStars },
    { label: "Public Repos", value: data.totalRepos },
    { label: "Contributions (yr)", value: data.contributions },
  ];

  const statBoxWidth = (W - 60) / statBoxes.length;
  const statBoxesSVG = statBoxes
    .map((s, i) => {
      const x = 30 + i * statBoxWidth;
      return `
      <g transform="translate(${x}, 70)" class="glow-pulse" style="animation-delay:${i * 0.3}s">
        <rect x="0" y="0" width="${statBoxWidth - 16}" height="70" rx="12"
              fill="url(#cardGrad)" stroke="#30363d" stroke-width="1"/>
        <text x="${(statBoxWidth - 16) / 2}" y="30" text-anchor="middle" class="stat-value" filter="url(#glow)">${s.value}</text>
        <text x="${(statBoxWidth - 16) / 2}" y="52" text-anchor="middle" class="stat-label">${esc(s.label)}</text>
      </g>`;
    })
    .join("");

  const langBarsSVG = data.topLanguages
    .map((lang, i) => {
      const y = 220 + i * 26;
      const maxBarWidth = 260;
      const barWidth = Math.max(6, (lang.percent / 100) * maxBarWidth);
      return `
      <g transform="translate(30, ${y})">
        <text x="0" y="0" class="lang-label">${esc(lang.name)}</text>
        <text x="290" y="0" text-anchor="end" class="lang-percent">${lang.percent}%</text>
        <rect x="0" y="6" width="${maxBarWidth}" height="6" rx="3" fill="#21262d"/>
        <rect x="0" y="6" width="${barWidth}" height="6" rx="3" fill="${lang.color}"
              class="bar" style="animation-delay:${0.15 * i}s" filter="url(#glow)"/>
      </g>`;
    })
    .join("");

  const repoRowsSVG = data.topRepos
    .map((repo, i) => {
      const y = 220 + i * 34;
      return `
      <g transform="translate(460, ${y})" class="repo-row" style="animation-delay:${0.15 * i}s">
        <circle cx="4" cy="-4" r="4" fill="${repo.color}"/>
        <text x="16" y="0" class="repo-name">${esc(repo.name)}</text>
        <text x="360" y="0" text-anchor="end" class="repo-stars">&#9733; ${repo.stars}</text>
      </g>`;
    })
    .join("");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
    <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#161b22"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <linearGradient id="titleGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#58a6ff"/>
      <stop offset="50%" stop-color="#a371f7"/>
      <stop offset="100%" stop-color="#39d353"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3.2" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <style>
    .card-bg { fill: url(#bgGrad); }
    text { font-family: -apple-system, "Segoe UI", Ubuntu, Roboto, sans-serif; }
    .title { fill: url(#titleGrad); font-size: 26px; font-weight: 700; }
    .subtitle { fill: #7d8590; font-size: 13px; }
    .section-title { fill: #e6edf3; font-size: 14px; font-weight: 600; letter-spacing: 0.5px; }
    .stat-label { fill: #7d8590; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
    .stat-value { fill: #58a6ff; font-size: 22px; font-weight: 700; }
    .lang-label { fill: #c9d1d9; font-size: 12px; }
    .lang-percent { fill: #7d8590; font-size: 11px; }
    .repo-name { fill: #c9d1d9; font-size: 12px; }
    .repo-stars { fill: #e3b341; font-size: 12px; }
    .border { fill: none; stroke: #30363d; stroke-width: 1.5; rx: 16; }

    @keyframes pulseGlow {
      0%, 100% { opacity: 0.75; }
      50% { opacity: 1; }
    }
    @keyframes growBar {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }
    @keyframes fadeSlideIn {
      from { opacity: 0; transform: translateX(-6px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes titlePulse {
      0%, 100% { filter: drop-shadow(0 0 4px rgba(88,166,255,0.6)); }
      50% { filter: drop-shadow(0 0 12px rgba(163,113,247,0.9)); }
    }

    .glow-pulse { animation: pulseGlow 3.5s ease-in-out infinite; }
    .bar { transform-box: fill-box; transform-origin: left center; animation: growBar 1s ease-out forwards; }
    .repo-row { opacity: 0; animation: fadeSlideIn 0.6s ease-out forwards; }
    .title-pulse { animation: titlePulse 4s ease-in-out infinite; }
  </style>

  <rect x="0" y="0" width="${W}" height="${H}" rx="18" class="card-bg"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="17" class="border"/>

  <text x="30" y="42" class="title title-pulse">${esc(data.name)}</text>
  <text x="30" y="60" class="subtitle">@${esc(data.login)} &#183; live GitHub dashboard</text>

  ${statBoxesSVG}

  <text x="30" y="195" class="section-title">TOP LANGUAGES</text>
  <text x="460" y="195" class="section-title">TOP REPOSITORIES</text>

  ${langBarsSVG}
  ${repoRowsSVG}

  <line x1="440" y1="185" x2="440" y2="${H - 25}" stroke="#30363d" stroke-width="1"/>
  <text x="${W / 2}" y="${H - 14}" text-anchor="middle" class="subtitle">updated automatically via GitHub Actions</text>
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
