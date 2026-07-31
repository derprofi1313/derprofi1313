import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_USER = "derprofi1313";
const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

const PROFILE_QUERY = `
  query ProfileVisuals($login: String!, $cursor: String) {
    user(login: $login) {
      repositories(
        ownerAffiliations: OWNER
        privacy: PUBLIC
        first: 100
        after: $cursor
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          isFork
          stargazerCount
          languages(first: 100, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
              }
            }
          }
        }
      }
      contributionsCollection {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              date
              weekday
            }
          }
        }
      }
    }
  }
`;

const palette = {
  void: "#080B14",
  panel: "#101625",
  panelRaised: "#141D2E",
  grid: "#1C2940",
  paper: "#F4F7FB",
  muted: "#9AA8BC",
  pink: "#FF5FA2",
  violet: "#A78BFA",
  cyan: "#47D7FF",
  heat: ["#182235", "#39275F", "#6840A8", "#A04FCE", "#FF5FA2"],
};

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cleanSvg(value) {
  return value.replace(/[ \t]+$/gm, "");
}

function roundPercentage(value) {
  return Math.round(value * 100) / 100;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeCount(value) {
  const count = Number(value);

  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }

  return Math.trunc(count);
}

function safeWeekday(value, fallbackDate) {
  const weekday = Number(value);

  if (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) {
    return weekday;
  }

  const parsed = new Date(`${fallbackDate}T00:00:00Z`);

  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getUTCDay();
}

function normalizeContributionDay(day) {
  const fallbackDate = "1970-01-01";
  const date =
    typeof day?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.date)
      ? day.date
      : fallbackDate;

  return {
    contributionCount: safeCount(day?.contributionCount),
    date,
    weekday: safeWeekday(day?.weekday, date),
  };
}

export function normalizeContributionCalendar(calendar = {}) {
  const weeks = asArray(calendar.weeks).map((week) => ({
    contributionDays: asArray(week?.contributionDays).map(normalizeContributionDay),
  }));
  const computedTotal = weeks.reduce(
    (weekTotal, week) =>
      weekTotal +
      week.contributionDays.reduce(
        (dayTotal, day) => dayTotal + day.contributionCount,
        0,
      ),
    0,
  );
  const totalContributions = safeCount(calendar.totalContributions);

  return {
    totalContributions:
      totalContributions > 0 || computedTotal === 0
        ? totalContributions
        : computedTotal,
    weeks,
  };
}

function normalizeContributionsCollection(collection = {}) {
  const contributionCalendar = normalizeContributionCalendar(
    collection.contributionCalendar,
  );

  return {
    totalCommitContributions: safeCount(collection.totalCommitContributions),
    totalIssueContributions: safeCount(collection.totalIssueContributions),
    totalPullRequestContributions: safeCount(
      collection.totalPullRequestContributions,
    ),
    contributionCalendar,
  };
}

function normalizeRepository(repository) {
  return {
    isFork: Boolean(repository?.isFork),
    stargazerCount: safeCount(repository?.stargazerCount),
    languages: {
      edges: asArray(repository?.languages?.edges),
    },
  };
}

export function summarizeProfile(profile) {
  const repositories = asArray(profile.repositories?.nodes)
    .map(normalizeRepository)
    .filter((repository) => !repository.isFork);
  const languageSizes = new Map();

  for (const repository of repositories) {
    for (const edge of asArray(repository.languages?.edges)) {
      const name = edge?.node?.name;
      const size = safeCount(edge?.size);

      if (!name || !Number.isFinite(size) || size <= 0) {
        continue;
      }

      languageSizes.set(name, (languageSizes.get(name) ?? 0) + size);
    }
  }

  const languageTotal = [...languageSizes.values()].reduce(
    (total, size) => total + size,
    0,
  );
  const languages = [...languageSizes.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, size]) => ({
      name,
      size,
      percentage:
        languageTotal === 0 ? 0 : roundPercentage((size / languageTotal) * 100),
    }));
  const contributions = normalizeContributionsCollection(
    profile.contributionsCollection,
  );

  return {
    repositoryCount: repositories.length,
    starCount: repositories.reduce(
      (total, repository) => total + repository.stargazerCount,
      0,
    ),
    totalContributions: contributions.contributionCalendar.totalContributions,
    commitContributions: contributions.totalCommitContributions,
    issueContributions: contributions.totalIssueContributions,
    pullRequestContributions: contributions.totalPullRequestContributions,
    languages,
  };
}

function compactLanguages(languages) {
  if (languages.length <= 5) {
    return languages;
  }

  const visible = languages.slice(0, 4);
  const otherPercentage = roundPercentage(
    languages
      .slice(4)
      .reduce((total, language) => total + language.percentage, 0),
  );

  return [
    ...visible,
    {
      name: "Other",
      size: languages
        .slice(4)
        .reduce((total, language) => total + language.size, 0),
      percentage: otherPercentage,
    },
  ];
}

function metricCard({ x, label, value, detail, accent }) {
  return `
    <g transform="translate(${x} 128)">
      <rect width="184" height="132" rx="18" fill="${palette.panelRaised}" stroke="${palette.grid}"/>
      <rect x="18" y="20" width="30" height="4" rx="2" fill="${accent}"/>
      <text x="18" y="67" class="metric">${escapeXml(value)}</text>
      <text x="18" y="94" class="label">${escapeXml(label)}</text>
      <text x="18" y="115" class="detail">${escapeXml(detail)}</text>
    </g>`;
}

export function renderStatsSvg(summary, generatedOn) {
  const languages = compactLanguages(summary.languages);
  const languageColors = [
    palette.pink,
    palette.violet,
    palette.cyan,
    "#7EE2B8",
    "#F3C969",
  ];
  const barWidth = 384;
  let cursor = 0;
  const barSegments =
    languages.length === 0
      ? `<rect x="0" y="0" width="${barWidth}" height="12" rx="6" fill="${palette.grid}"/>`
      : languages
          .map((language, index) => {
            const width =
              index === languages.length - 1
                ? barWidth - cursor
                : Math.max(
                    2,
                    Math.round((language.percentage / 100) * barWidth),
                  );
            const segment = `<rect x="${cursor}" y="0" width="${width}" height="12" fill="${languageColors[index]}"/>`;
            cursor += width;
            return segment;
          })
          .join("");
  const languageLabels =
    languages.length === 0
      ? `<text x="0" y="46" class="detail">No public language data yet</text>`
      : languages
          .map((language, index) => {
            const column = index % 2;
            const row = Math.floor(index / 2);
            const x = column * 196;
            const y = 48 + row * 34;

            return `
              <g transform="translate(${x} ${y})">
                <rect width="10" height="10" rx="3" fill="${languageColors[index]}"/>
                <text x="18" y="10" class="language">${escapeXml(language.name)}</text>
                <text x="178" y="10" text-anchor="end" class="percentage">${language.percentage.toFixed(1)}%</text>
              </g>`;
          })
          .join("");

  return cleanSvg(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="330" viewBox="0 0 1160 330" role="img" aria-labelledby="title desc">
  <title id="title">Public GitHub snapshot for ${DEFAULT_USER}</title>
  <desc id="desc">${summary.repositoryCount} public source repositories, ${summary.starCount} stars, and ${summary.totalContributions} contributions across the last 12 months.</desc>
  <defs>
    <linearGradient id="statsBorder" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.pink}"/>
      <stop offset="0.52" stop-color="${palette.violet}"/>
      <stop offset="1" stop-color="${palette.cyan}"/>
    </linearGradient>
    <style>
      .eyebrow { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; font-weight: 700; letter-spacing: 2px; fill: ${palette.cyan}; }
      .heading { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 28px; font-weight: 800; fill: ${palette.paper}; }
      .metric { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 37px; font-weight: 800; fill: ${palette.paper}; }
      .label { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; font-weight: 700; letter-spacing: 1px; fill: ${palette.violet}; }
      .detail { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 11px; font-weight: 500; fill: ${palette.muted}; }
      .language { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; font-weight: 650; fill: ${palette.paper}; }
      .percentage { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 600; fill: ${palette.muted}; }
    </style>
  </defs>
  <rect x="1" y="1" width="1158" height="328" rx="24" fill="${palette.void}" stroke="url(#statsBorder)" stroke-opacity="0.72" stroke-width="2"/>
  <path d="M24 90 H1136" stroke="${palette.grid}"/>
  <text x="42" y="40" class="eyebrow">PUBLIC GITHUB SNAPSHOT</text>
  <text x="42" y="72" class="heading">Proof, not vanity.</text>
  ${metricCard({
    x: 42,
    label: "PUBLIC REPOS",
    value: formatNumber(summary.repositoryCount),
    detail: "owned · non-fork",
    accent: palette.pink,
  })}
  ${metricCard({
    x: 244,
    label: "STARS EARNED",
    value: formatNumber(summary.starCount),
    detail: "across public work",
    accent: palette.violet,
  })}
  ${metricCard({
    x: 446,
    label: "CONTRIBUTIONS",
    value: formatNumber(summary.totalContributions),
    detail: "rolling 12 months",
    accent: palette.cyan,
  })}
  <g transform="translate(704 128)">
    <text x="0" y="0" class="eyebrow">LANGUAGE SIGNAL</text>
    <text x="384" y="0" text-anchor="end" class="detail">public owned repositories</text>
    <g transform="translate(0 28)">
      <clipPath id="languageBarClip">
        <rect width="${barWidth}" height="12" rx="6"/>
      </clipPath>
      <g clip-path="url(#languageBarClip)">${barSegments}</g>
    </g>
    ${languageLabels}
  </g>
  <text x="42" y="303" class="detail">Generated ${escapeXml(generatedOn)} from public GitHub data · commits ${formatNumber(summary.commitContributions)} · issues ${formatNumber(summary.issueContributions)} · pull requests ${formatNumber(summary.pullRequestContributions)}</text>
</svg>
`);
}

function mobileMetricCard({ x, label, value, detail, accent }) {
  return `
    <g transform="translate(${x} 128)">
      <rect width="188" height="164" rx="20" fill="${palette.panelRaised}" stroke="${palette.grid}" stroke-width="2"/>
      <rect x="18" y="20" width="34" height="5" rx="2.5" fill="${accent}"/>
      <text x="18" y="80" class="metric">${escapeXml(value)}</text>
      <text x="18" y="114" class="label">${escapeXml(label)}</text>
      <text x="18" y="143" class="detail">${escapeXml(detail)}</text>
    </g>`;
}

export function renderStatsMobileSvg(summary, generatedOn) {
  const languages = compactLanguages(summary.languages);
  const languageColors = [
    palette.pink,
    palette.violet,
    palette.cyan,
    "#7EE2B8",
    "#F3C969",
  ];
  const barWidth = 604;
  let cumulativePercentage = 0;
  const barStops =
    languages.length === 0
      ? `<stop offset="0" stop-color="${palette.grid}"/><stop offset="1" stop-color="${palette.grid}"/>`
      : languages
          .map((language, index) => {
            const start = cumulativePercentage;
            cumulativePercentage += language.percentage;
            const end =
              index === languages.length - 1 ? 100 : cumulativePercentage;

            return `<stop offset="${start.toFixed(2)}%" stop-color="${languageColors[index]}"/><stop offset="${end.toFixed(2)}%" stop-color="${languageColors[index]}"/>`;
          })
          .join("");
  const languageLabels =
    languages.length === 0
      ? `<text x="38" y="442" class="detail">No public language data yet</text>`
      : languages
          .map((language, index) => {
            const column = index % 2;
            const row = Math.floor(index / 2);
            const x = 38 + column * 310;
            const y = 442 + row * 42;

            return `
              <g transform="translate(${x} ${y})">
                <rect width="15" height="15" rx="4" fill="${languageColors[index]}"/>
                <text x="25" y="14" class="language">${escapeXml(language.name)}</text>
                <text x="280" y="14" text-anchor="end" class="percentage">${language.percentage.toFixed(1)}%</text>
              </g>`;
          })
          .join("");

  return cleanSvg(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="680" height="600" viewBox="0 0 680 600" role="img" aria-labelledby="title desc">
  <title id="title">Public GitHub snapshot for ${DEFAULT_USER}</title>
  <desc id="desc">${summary.repositoryCount} public source repositories, ${summary.starCount} stars, and ${summary.totalContributions} contributions across the last 12 months.</desc>
  <defs>
    <linearGradient id="mobileStatsBorder" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.pink}"/>
      <stop offset="0.52" stop-color="${palette.violet}"/>
      <stop offset="1" stop-color="${palette.cyan}"/>
    </linearGradient>
    <linearGradient id="mobileLanguageSignal" x1="0" y1="0" x2="1" y2="0">
      ${barStops}
    </linearGradient>
    <style>
      .eyebrow { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20px; font-weight: 700; letter-spacing: 2px; fill: ${palette.cyan}; }
      .heading { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 40px; font-weight: 800; fill: ${palette.paper}; }
      .metric { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 48px; font-weight: 800; fill: ${palette.paper}; }
      .label { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 17px; font-weight: 700; letter-spacing: 0.8px; fill: ${palette.violet}; }
      .detail { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 16px; font-weight: 500; fill: ${palette.muted}; }
      .language { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 18px; font-weight: 650; fill: ${palette.paper}; }
      .percentage { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 17px; font-weight: 600; fill: ${palette.muted}; }
    </style>
  </defs>
  <rect x="1" y="1" width="678" height="598" rx="28" fill="${palette.void}" stroke="url(#mobileStatsBorder)" stroke-opacity="0.72" stroke-width="2"/>
  <text x="38" y="42" class="eyebrow">PUBLIC GITHUB SNAPSHOT</text>
  <text x="38" y="88" class="heading">Proof, not vanity.</text>
  ${mobileMetricCard({
    x: 38,
    label: "PUBLIC REPOS",
    value: formatNumber(summary.repositoryCount),
    detail: "owned · non-fork",
    accent: palette.pink,
  })}
  ${mobileMetricCard({
    x: 246,
    label: "STARS EARNED",
    value: formatNumber(summary.starCount),
    detail: "public work",
    accent: palette.violet,
  })}
  ${mobileMetricCard({
    x: 454,
    label: "CONTRIBUTIONS",
    value: formatNumber(summary.totalContributions),
    detail: "rolling 12 months",
    accent: palette.cyan,
  })}
  <text x="38" y="348" class="eyebrow">LANGUAGE SIGNAL</text>
  <rect x="38" y="378" width="${barWidth}" height="18" rx="9" fill="url(#mobileLanguageSignal)"/>
  ${languageLabels}
  <text x="38" y="568" class="detail">Generated ${escapeXml(generatedOn)} from public GitHub data</text>
</svg>
`);
}

function contributionLevel(count, maximum) {
  if (count <= 0 || maximum <= 0) {
    return 0;
  }

  return Math.min(4, Math.max(1, Math.ceil((count / maximum) * 4)));
}

function monthLabel(date) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return months[Number(date.slice(5, 7)) - 1] ?? "";
}

export function renderContributionSvg(
  calendar,
  generatedOn,
  user = DEFAULT_USER,
) {
  const normalizedCalendar = normalizeContributionCalendar(calendar);
  const weeks = normalizedCalendar.weeks.slice(-53);
  const days = weeks.flatMap((week) => week.contributionDays);
  const maximum = days.reduce(
    (current, day) => Math.max(current, day.contributionCount),
    0,
  );
  const cellSize = 14;
  const pitch = 18;
  const startX = 112;
  const startY = 119;
  const cells = weeks
    .flatMap((week, weekIndex) =>
      week.contributionDays.map((day) => {
        const count = day.contributionCount;
        const x = startX + weekIndex * pitch;
        const y = startY + Number(day.weekday ?? 0) * pitch;
        const level = contributionLevel(count, maximum);
        const noun = count === 1 ? "contribution" : "contributions";

        return `<rect data-date="${escapeXml(day.date)}" x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="3" fill="${palette.heat[level]}" aria-label="${escapeXml(`${day.date}: ${count} ${noun}`)}"/>`;
      }),
    )
    .join("\n    ");
  let previousMonth = "";
  let lastLabelIndex = -4;
  const monthLabels = weeks
    .map((week, weekIndex) => {
      const anchor = week.contributionDays[0];
      const currentMonth = anchor?.date?.slice(0, 7) ?? "";

      if (
        !currentMonth ||
        currentMonth === previousMonth ||
        weekIndex - lastLabelIndex < 3
      ) {
        previousMonth = currentMonth || previousMonth;
        return "";
      }

      previousMonth = currentMonth;
      lastLabelIndex = weekIndex;
      return `<text x="${startX + weekIndex * pitch}" y="101" class="month">${monthLabel(anchor.date)}</text>`;
    })
    .join("\n    ");
  const total = normalizedCalendar.totalContributions;

  return cleanSvg(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="300" viewBox="0 0 1160 300" role="img" aria-labelledby="title desc">
  <title id="title">Contribution signal for ${escapeXml(user)}</title>
  <desc id="desc">${formatNumber(total)} contributions across the last 12 months.</desc>
  <defs>
    <linearGradient id="graphBorder" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${palette.violet}"/>
      <stop offset="0.55" stop-color="${palette.pink}"/>
      <stop offset="1" stop-color="${palette.cyan}"/>
    </linearGradient>
    <style>
      .eyebrow { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; font-weight: 700; letter-spacing: 2px; fill: ${palette.cyan}; }
      .heading { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 26px; font-weight: 800; fill: ${palette.paper}; }
      .month, .day, .note { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 600; fill: ${palette.muted}; }
    </style>
  </defs>
  <rect x="1" y="1" width="1158" height="298" rx="24" fill="${palette.void}" stroke="url(#graphBorder)" stroke-opacity="0.62" stroke-width="2"/>
  <text x="42" y="40" class="eyebrow">CONTRIBUTION SIGNAL · LAST 12 MONTHS</text>
  <text x="42" y="72" class="heading">${formatNumber(total)} recorded contributions</text>
  ${monthLabels}
  <text x="68" y="${startY + pitch + 11}" class="day">Mon</text>
  <text x="68" y="${startY + pitch * 3 + 11}" class="day">Wed</text>
  <text x="68" y="${startY + pitch * 5 + 11}" class="day">Fri</text>
  <g>
    ${cells}
  </g>
  <text x="42" y="274" class="note">Generated ${escapeXml(generatedOn)} from public GitHub data</text>
  <g transform="translate(914 264)">
    <text x="-42" y="10" class="note">quiet</text>
    ${palette.heat
      .map(
        (color, index) =>
          `<rect x="${index * 20}" y="0" width="14" height="14" rx="3" fill="${color}"/>`,
      )
      .join("")}
    <text x="110" y="10" class="note">active</text>
  </g>
</svg>
`);
}

function monthlyContributionTotals(calendar) {
  const normalizedCalendar = normalizeContributionCalendar(calendar);
  const totals = new Map();

  for (const week of normalizedCalendar.weeks) {
    for (const day of week.contributionDays) {
      const key = day.date.slice(0, 7);

      if (!key) {
        continue;
      }

      totals.set(key, (totals.get(key) ?? 0) + day.contributionCount);
    }
  }

  return [...totals.entries()].map(([key, count]) => ({
    key,
    count,
    label: monthLabel(`${key}-01`),
  }));
}

export function renderContributionMobileSvg(
  calendar,
  generatedOn,
  user = DEFAULT_USER,
) {
  const normalizedCalendar = normalizeContributionCalendar(calendar);
  const months = monthlyContributionTotals(normalizedCalendar);
  const total = normalizedCalendar.totalContributions;
  const maximum = months.reduce(
    (current, month) => Math.max(current, month.count),
    0,
  );
  const chartLeft = 46;
  const chartWidth = 588;
  const baseline = 498;
  const maximumBarHeight = 292;
  const pitch = months.length === 0 ? chartWidth : chartWidth / months.length;
  const barWidth = Math.max(18, Math.min(34, pitch - 12));
  const bars = months
    .map((month, index) => {
      const height =
        month.count === 0 || maximum === 0
          ? 4
          : Math.max(10, (month.count / maximum) * maximumBarHeight);
      const x = chartLeft + index * pitch + (pitch - barWidth) / 2;
      const y = baseline - height;
      const firstOrJanuary = index === 0 || month.key.endsWith("-01");
      const finalMonth = index === months.length - 1;
      const showLabel = index % 2 === 0 || firstOrJanuary || finalMonth;
      const yearLabel =
        firstOrJanuary || finalMonth ? ` ’${month.key.slice(2, 4)}` : "";
      const axisLabel = showLabel ? `${month.label}${yearLabel}` : "";

      return `
        <g>
          <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}" rx="8" fill="url(#mobileBar)" opacity="${month.count === 0 ? "0.28" : "1"}"/>
          <text x="${(x + barWidth / 2).toFixed(2)}" y="${Math.max(190, y - 12).toFixed(2)}" text-anchor="middle" class="count">${month.count}</text>
          <text x="${(x + barWidth / 2).toFixed(2)}" y="532" text-anchor="middle" class="month">${axisLabel}</text>
        </g>`;
    })
    .join("");

  return cleanSvg(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="680" height="600" viewBox="0 0 680 600" role="img" aria-labelledby="title desc">
  <title id="title">Contribution signal for ${escapeXml(user)}</title>
  <desc id="desc">${formatNumber(total)} contributions across the last 12 months, grouped by month for mobile readability.</desc>
  <defs>
    <linearGradient id="mobileGraphBorder" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${palette.violet}"/>
      <stop offset="0.55" stop-color="${palette.pink}"/>
      <stop offset="1" stop-color="${palette.cyan}"/>
    </linearGradient>
    <linearGradient id="mobileBar" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="${palette.violet}"/>
      <stop offset="1" stop-color="${palette.pink}"/>
    </linearGradient>
    <style>
      .eyebrow { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20px; font-weight: 700; letter-spacing: 2px; fill: ${palette.cyan}; }
      .heading { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 40px; font-weight: 800; fill: ${palette.paper}; }
      .month { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 15px; font-weight: 600; fill: ${palette.muted}; }
      .count { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 16px; font-weight: 700; fill: ${palette.paper}; }
      .note { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 16px; font-weight: 500; fill: ${palette.muted}; }
    </style>
  </defs>
  <rect x="1" y="1" width="678" height="598" rx="28" fill="${palette.void}" stroke="url(#mobileGraphBorder)" stroke-opacity="0.72" stroke-width="2"/>
  <text x="38" y="42" class="eyebrow">CONTRIBUTION SIGNAL · MONTHLY RHYTHM</text>
  <text x="38" y="90" class="heading">${formatNumber(total)} recorded contributions</text>
  <path d="M46 ${baseline}H634" stroke="${palette.grid}" stroke-width="2"/>
  ${bars}
  <text x="38" y="570" class="note">Generated ${escapeXml(generatedOn)} from public GitHub data</text>
</svg>
`);
}

const SNAPSHOT_START = "<!-- profile-data:start -->";
const SNAPSHOT_END = "<!-- profile-data:end -->";

export function replaceSnapshotBlock(readme, summary, generatedOn) {
  const start = readme.indexOf(SNAPSHOT_START);
  const end = readme.indexOf(SNAPSHOT_END);

  if (start === -1 || end === -1 || end < start) {
    throw new Error("README snapshot markers are missing or out of order");
  }

  const repositoryNoun =
    summary.repositoryCount === 1 ? "repository" : "repositories";
  const starNoun = summary.starCount === 1 ? "star" : "stars";
  const contributionNoun =
    summary.totalContributions === 1 ? "contribution" : "contributions";
  const block = `${SNAPSHOT_START}
**Current public snapshot:** ${formatNumber(summary.repositoryCount)} owned non-fork ${repositoryNoun} · ${formatNumber(summary.starCount)} ${starNoun} · ${formatNumber(summary.totalContributions)} ${contributionNoun} in the rolling 12 months. Generated ${escapeXml(generatedOn)} from public GitHub data.
${SNAPSHOT_END}`;

  return `${readme.slice(0, start)}${block}${readme.slice(end + SNAPSHOT_END.length)}`;
}

function requirePublicCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`GitHub GraphQL returned an invalid ${label}`);
  }

  return value;
}

function validateContributionCalendar(calendar) {
  if (!calendar || typeof calendar !== "object") {
    throw new Error(
      "GitHub GraphQL returned an invalid contribution calendar shape",
    );
  }

  requirePublicCount(
    calendar.totalContributions,
    "contribution total",
  );

  if (!Array.isArray(calendar.weeks)) {
    throw new Error("GitHub GraphQL returned invalid contribution weeks");
  }

  for (const week of calendar.weeks) {
    if (!week || !Array.isArray(week.contributionDays)) {
      throw new Error("GitHub GraphQL returned invalid contribution days");
    }

    for (const day of week.contributionDays) {
      requirePublicCount(day?.contributionCount, "daily contribution count");

      if (
        typeof day?.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
        Number.isNaN(new Date(`${day.date}T00:00:00Z`).getTime())
      ) {
        throw new Error("GitHub GraphQL returned an invalid contribution date");
      }

      if (
        !Number.isInteger(day.weekday) ||
        day.weekday < 0 ||
        day.weekday > 6
      ) {
        throw new Error(
          "GitHub GraphQL returned an invalid contribution weekday",
        );
      }
    }
  }
}

function validateContributionsCollection(collection) {
  if (!collection || typeof collection !== "object") {
    throw new Error(
      "GitHub GraphQL returned an invalid contributions collection",
    );
  }

  requirePublicCount(
    collection.totalCommitContributions,
    "commit contribution count",
  );
  requirePublicCount(
    collection.totalIssueContributions,
    "issue contribution count",
  );
  requirePublicCount(
    collection.totalPullRequestContributions,
    "pull-request contribution count",
  );
  validateContributionCalendar(collection.contributionCalendar);
}

function validateRepositoryNode(repository) {
  if (!repository || typeof repository !== "object") {
    throw new Error("GitHub GraphQL returned an invalid repository node");
  }

  if (typeof repository.isFork !== "boolean") {
    throw new Error("GitHub GraphQL returned an invalid repository fork flag");
  }

  requirePublicCount(repository.stargazerCount, "repository star count");

  if (!repository.languages || !Array.isArray(repository.languages.edges)) {
    throw new Error("GitHub GraphQL returned an invalid repository language shape");
  }

  for (const edge of repository.languages.edges) {
    requirePublicCount(edge?.size, "repository language size");

    if (typeof edge?.node?.name !== "string" || edge.node.name.length === 0) {
      throw new Error("GitHub GraphQL returned an invalid language name");
    }
  }
}

export async function fetchProfile(login, token, fetcher = fetch) {
  const repositories = [];
  let profile;
  let cursor = null;
  let page = 0;

  do {
    page += 1;

    if (page > 50) {
      throw new Error("GitHub GraphQL pagination exceeded the safety limit");
    }

    const response = await fetcher(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": `${DEFAULT_USER}-profile-renderer`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        query: PROFILE_QUERY,
        variables: { login, cursor },
      }),
    });

    if (!response || typeof response !== "object") {
      throw new Error("GitHub GraphQL returned an invalid network response");
    }

    if (!response.ok) {
      throw new Error(
        `GitHub GraphQL request failed: ${response.status} ${response.statusText}`,
      );
    }

    if (typeof response.json !== "function") {
      throw new Error("GitHub GraphQL response cannot be decoded as JSON");
    }

    let payload;

    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(
        `GitHub GraphQL response was not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("GitHub GraphQL returned an invalid payload shape");
    }

    if (payload.errors?.length) {
      throw new Error(
        `GitHub GraphQL returned errors: ${payload.errors
          .map((error) => error.message)
          .join("; ")}`,
      );
    }

    if (!payload.data?.user) {
      throw new Error(`GitHub user "${login}" was not found`);
    }

    const user = payload.data.user;
    const repositoryConnection = user.repositories;

    if (!repositoryConnection || typeof repositoryConnection !== "object") {
      throw new Error("GitHub GraphQL returned an invalid repositories shape");
    }

    if (!Array.isArray(repositoryConnection.nodes)) {
      throw new Error("GitHub GraphQL returned invalid repository nodes");
    }

    for (const repository of repositoryConnection.nodes) {
      validateRepositoryNode(repository);
    }

    validateContributionsCollection(user.contributionsCollection);

    profile ??= user;
    repositories.push(...repositoryConnection.nodes);
    const pageInfo = payload.data.user.repositories.pageInfo;

    if (
      !pageInfo ||
      typeof pageInfo !== "object" ||
      typeof pageInfo.hasNextPage !== "boolean"
    ) {
      throw new Error("GitHub GraphQL returned invalid repository pagination");
    }

    if (
      pageInfo.hasNextPage &&
      (typeof pageInfo.endCursor !== "string" || pageInfo.endCursor.length === 0)
    ) {
      throw new Error(
        "GitHub GraphQL pagination indicated another page without an end cursor",
      );
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  return {
    ...profile,
    repositories: {
      ...profile.repositories,
      nodes: repositories,
    },
    contributionsCollection: profile.contributionsCollection,
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const login = process.env.GITHUB_USER ?? DEFAULT_USER;

  if (!token) {
    throw new Error("Set GITHUB_TOKEN or GH_TOKEN before rendering");
  }

  const profile = await fetchProfile(login, token);
  const summary = summarizeProfile(profile);
  const generatedOn =
    process.env.PROFILE_RENDER_DATE ?? new Date().toISOString().slice(0, 10);
  const assetsDirectory = path.join(process.cwd(), "assets");
  const readmePath = path.join(process.cwd(), "README.md");
  const readme = await readFile(readmePath, "utf8");

  await mkdir(assetsDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(assetsDirectory, "profile-stats.svg"),
      renderStatsSvg(summary, generatedOn),
      "utf8",
    ),
    writeFile(
      path.join(assetsDirectory, "profile-stats-mobile.svg"),
      renderStatsMobileSvg(summary, generatedOn),
      "utf8",
    ),
    writeFile(
      path.join(assetsDirectory, "contribution-signal.svg"),
      renderContributionSvg(
        profile.contributionsCollection.contributionCalendar,
        generatedOn,
        login,
      ),
      "utf8",
    ),
    writeFile(
      path.join(assetsDirectory, "contribution-signal-mobile.svg"),
      renderContributionMobileSvg(
        profile.contributionsCollection.contributionCalendar,
        generatedOn,
        login,
      ),
      "utf8",
    ),
    writeFile(
      readmePath,
      replaceSnapshotBlock(readme, summary, generatedOn),
      "utf8",
    ),
  ]);

  console.log(
    `Rendered profile visuals for ${login}: ${summary.repositoryCount} repositories, ${summary.totalContributions} contributions`,
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
