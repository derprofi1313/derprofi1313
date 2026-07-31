import assert from "node:assert/strict";
import test from "node:test";

import {
  escapeXml,
  fetchProfile,
  normalizeContributionCalendar,
  renderContributionMobileSvg,
  renderContributionSvg,
  renderStatsMobileSvg,
  renderStatsSvg,
  replaceSnapshotBlock,
  summarizeProfile,
} from "../scripts/render-profile.mjs";

const profileFixture = {
  repositories: {
    nodes: [
      {
        isArchived: false,
        isFork: false,
        stargazerCount: 5,
        languages: {
          edges: [
            { size: 800, node: { name: "TypeScript" } },
            { size: 200, node: { name: "CSS" } },
          ],
        },
      },
      {
        isArchived: false,
        isFork: false,
        stargazerCount: 2,
        languages: {
          edges: [
            { size: 200, node: { name: "TypeScript" } },
            { size: 500, node: { name: "Python" } },
          ],
        },
      },
      {
        isArchived: false,
        isFork: true,
        stargazerCount: 99,
        languages: {
          edges: [{ size: 9_999, node: { name: "Forked" } }],
        },
      },
      {
        isArchived: true,
        isFork: false,
        stargazerCount: 88,
        languages: {
          edges: [{ size: 8_888, node: { name: "Archived" } }],
        },
      },
    ],
  },
  contributionsCollection: {
    totalCommitContributions: 12,
    totalIssueContributions: 3,
    totalPullRequestContributions: 2,
    contributionCalendar: {
      totalContributions: 21,
      weeks: [
        {
          contributionDays: [
            {
              contributionCount: 0,
              date: "2026-07-19",
              weekday: 0,
            },
            {
              contributionCount: 4,
              date: "2026-07-20",
              weekday: 1,
            },
          ],
        },
      ],
    },
  },
};

function publicApiProfilePayload({
  nodes = [],
  pageInfo = { hasNextPage: false, endCursor: null },
  contributionsCollection = {
    totalCommitContributions: 0,
    totalIssueContributions: 0,
    totalPullRequestContributions: 0,
    contributionCalendar: { totalContributions: 0, weeks: [] },
  },
} = {}) {
  return {
    data: {
      user: {
        repositories: { pageInfo, nodes },
        contributionsCollection,
      },
    },
  };
}

test("escapeXml neutralizes data before it enters an SVG", () => {
  assert.equal(
    escapeXml(`<script data-x="1">Tom & Jerry's</script>`),
    "&lt;script data-x=&quot;1&quot;&gt;Tom &amp; Jerry&apos;s&lt;/script&gt;",
  );
});

test("summarizeProfile counts only active, owned, non-fork public work", () => {
  const summary = summarizeProfile(profileFixture);

  assert.equal(summary.repositoryCount, 2);
  assert.equal(summary.starCount, 7);
  assert.equal(summary.totalContributions, 21);
  assert.equal(summary.commitContributions, 12);
  assert.deepEqual(summary.languages, [
    { name: "TypeScript", size: 1_000, percentage: 58.82 },
    { name: "Python", size: 500, percentage: 29.41 },
    { name: "CSS", size: 200, percentage: 11.76 },
  ]);
});

test("summarizeProfile normalizes malformed public API counts", () => {
  const summary = summarizeProfile({
    repositories: {
      nodes: [
        {
          isArchived: false,
          isFork: false,
          stargazerCount: "4",
          languages: {
            edges: [
              { size: "50", node: { name: "JavaScript" } },
              { size: -10, node: { name: "Ignored" } },
              { size: Number.NaN, node: { name: "Also ignored" } },
            ],
          },
        },
        {
          isArchived: false,
          isFork: false,
          stargazerCount: "not-a-number",
          languages: { edges: "malformed" },
        },
      ],
    },
    contributionsCollection: {
      totalCommitContributions: "3",
      totalIssueContributions: -2,
      totalPullRequestContributions: "bad",
      contributionCalendar: {
        totalContributions: "bad",
        weeks: [
          {
            contributionDays: [
              { contributionCount: "2", date: "2026-07-20", weekday: 1 },
              { contributionCount: -9, date: "bad-date", weekday: 99 },
            ],
          },
        ],
      },
    },
  });

  assert.equal(summary.repositoryCount, 2);
  assert.equal(summary.starCount, 4);
  assert.equal(summary.totalContributions, 2);
  assert.equal(summary.commitContributions, 3);
  assert.equal(summary.issueContributions, 0);
  assert.equal(summary.pullRequestContributions, 0);
  assert.deepEqual(summary.languages, [
    { name: "JavaScript", size: 50, percentage: 100 },
  ]);
});

test("normalizeContributionCalendar repairs malformed days without throwing", () => {
  const calendar = normalizeContributionCalendar({
    totalContributions: undefined,
    weeks: [
      {
        contributionDays: [
          { contributionCount: "5", date: "2026-07-21", weekday: "bad" },
          { contributionCount: "bad", date: "not-a-date", weekday: 6 },
        ],
      },
      { contributionDays: null },
    ],
  });

  assert.equal(calendar.totalContributions, 5);
  assert.deepEqual(calendar.weeks[0].contributionDays, [
    { contributionCount: 5, date: "2026-07-21", weekday: 2 },
    { contributionCount: 0, date: "1970-01-01", weekday: 6 },
  ]);
});

test("renderStatsSvg stays factual and XML-safe", () => {
  const summary = summarizeProfile(profileFixture);
  summary.languages[0].name = `<script>alert("x")</script>`;

  const svg = renderStatsSvg(summary, "2026-07-26");

  assert.match(svg, /PUBLIC GITHUB SNAPSHOT/);
  assert.match(svg, />21</);
  assert.match(svg, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /Generated 2026-07-26 from public GitHub data/);
});

test("renderContributionSvg tolerates malformed calendar values", () => {
  const svg = renderContributionSvg(
    {
      totalContributions: "bad",
      weeks: [
        {
          contributionDays: [
            { contributionCount: "4", date: "2026-07-20", weekday: "1" },
            { contributionCount: -1, date: "bad", weekday: "bad" },
          ],
        },
      ],
    },
    "2026-07-26",
  );

  assert.match(svg, /4 contributions across the last 12 months/);
  assert.match(svg, /data-date="1970-01-01"/);
  assert.match(svg, /aria-label="1970-01-01: 0 contributions"/);
});

test("renderContributionSvg preserves dates and counts in the raw asset", () => {
  const svg = renderContributionSvg(
    profileFixture.contributionsCollection.contributionCalendar,
    "2026-07-26",
  );

  assert.match(
    svg,
    /<title id="title">Contribution signal for derprofi1313<\/title>/,
  );
  assert.match(svg, /21 contributions across the last 12 months/);
  assert.match(svg, /data-date="2026-07-20"/);
  assert.match(svg, /aria-label="2026-07-20: 4 contributions"/);
  assert.match(svg, /Generated 2026-07-26 from public GitHub data/);
});

test("mobile cards use a narrower canvas and larger display type", () => {
  const summary = summarizeProfile(profileFixture);
  const stats = renderStatsMobileSvg(summary, "2026-07-26");
  const contributions = renderContributionMobileSvg(
    profileFixture.contributionsCollection.contributionCalendar,
    "2026-07-26",
  );

  assert.match(stats, /width="680" height="600" viewBox="0 0 680 600"/);
  assert.match(stats, /\.metric \{[^}]*font-size: 48px/);
  assert.match(contributions, /width="680" height="600" viewBox="0 0 680 600"/);
  assert.match(contributions, /MONTHLY RHYTHM/);
  assert.match(contributions, />4</);
});

test("replaceSnapshotBlock keeps current metrics available as README text", () => {
  const summary = summarizeProfile(profileFixture);
  const readme = [
    "Before",
    "<!-- profile-data:start -->",
    "stale",
    "<!-- profile-data:end -->",
    "After",
  ].join("\n");

  const updated = replaceSnapshotBlock(readme, summary, "2026-07-26");

  assert.match(updated, /\*\*Current public snapshot:\*\*/);
  assert.match(updated, /2 owned non-fork repositories/);
  assert.match(updated, /7 stars/);
  assert.match(updated, /21 contributions in the rolling 12 months/);
  assert.match(updated, /Generated 2026-07-26/);
  assert.match(updated, /^Before/m);
  assert.match(updated, /^After/m);
});

test("fetchProfile collects paginated repositories defensively", async () => {
  const pages = [
    publicApiProfilePayload({
      pageInfo: { hasNextPage: true, endCursor: "next" },
      nodes: [
        {
          isArchived: false,
          isFork: false,
          stargazerCount: 1,
          languages: { edges: [] },
        },
      ],
    }),
    publicApiProfilePayload({
      nodes: [
        {
          isArchived: false,
          isFork: false,
          stargazerCount: 2,
          languages: { edges: [] },
        },
      ],
    }),
  ];
  let callIndex = 0;
  const profile = await fetchProfile("derprofi1313", "token", async () => ({
    ok: true,
    json: async () => pages[callIndex++],
  }));

  assert.equal(callIndex, 2);
  assert.deepEqual(
    profile.repositories.nodes.map((repository) => repository.stargazerCount),
    [1, 2],
  );
});

test("fetchProfile rejects pagination without an end cursor", async () => {
  await assert.rejects(
    fetchProfile("derprofi1313", "token", async () => ({
      ok: true,
      json: async () => publicApiProfilePayload({
        pageInfo: { hasNextPage: true, endCursor: "" },
      }),
    })),
    /without an end cursor/,
  );
});

test("fetchProfile rejects missing pagination metadata", async () => {
  await assert.rejects(
    fetchProfile("derprofi1313", "token", async () => ({
      ok: true,
      json: async () => {
        const payload = publicApiProfilePayload();
        delete payload.data.user.repositories.pageInfo;
        return payload;
      },
    })),
    /invalid repository pagination/,
  );
});

test("fetchProfile rejects malformed factual counts", async () => {
  await assert.rejects(
    fetchProfile("derprofi1313", "token", async () => ({
      ok: true,
      json: async () => publicApiProfilePayload({
        nodes: [
          {
            isArchived: false,
            isFork: false,
            stargazerCount: "5",
            languages: { edges: [] },
          },
        ],
      }),
    })),
    /invalid repository star count/,
  );

  await assert.rejects(
    fetchProfile("derprofi1313", "token", async () => ({
      ok: true,
      json: async () => publicApiProfilePayload({
        contributionsCollection: {
          totalCommitContributions: -1,
          totalIssueContributions: 0,
          totalPullRequestContributions: 0,
          contributionCalendar: { totalContributions: 0, weeks: [] },
        },
      }),
    })),
    /invalid commit contribution count/,
  );
});

test("fetchProfile rejects invalid network response shapes", async () => {
  await assert.rejects(
    fetchProfile("derprofi1313", "token", async () => null),
    /invalid network response/,
  );

  await assert.rejects(
    fetchProfile("derprofi1313", "token", async () => ({
      ok: true,
    })),
    /cannot be decoded as JSON/,
  );

  await assert.rejects(
    fetchProfile("derprofi1313", "token", async () => ({
      ok: true,
      json: async () => null,
    })),
    /invalid payload shape/,
  );

  await assert.rejects(
    fetchProfile("derprofi1313", "token", async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    })),
    /not valid JSON/,
  );
});
