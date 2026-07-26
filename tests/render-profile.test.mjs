import assert from "node:assert/strict";
import test from "node:test";

import {
  escapeXml,
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
        isFork: true,
        stargazerCount: 99,
        languages: {
          edges: [{ size: 9_999, node: { name: "Forked" } }],
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

test("escapeXml neutralizes data before it enters an SVG", () => {
  assert.equal(
    escapeXml(`<script data-x="1">Tom & Jerry's</script>`),
    "&lt;script data-x=&quot;1&quot;&gt;Tom &amp; Jerry&apos;s&lt;/script&gt;",
  );
});

test("summarizeProfile counts only owned, non-fork public work", () => {
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
