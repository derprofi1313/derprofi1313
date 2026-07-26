# Jannik Agethen

I build evidence-first developer tools and practical AI systems.

## Featured work

### [Signal Scout](https://github.com/derprofi1313/signal-scout)

Git-native evidence CI for changes on public competitor pages. Signal Scout
captures reviewable before/after evidence, keeps side effects explicit, and now
runs as a first-party GitHub Action:

```yaml
- uses: derprofi1313/signal-scout@v0.2.0
```

- Deterministic `signal-scout/evidence@1` packets with hashes and exact diffs
- Local CLI and committed Node 24 GitHub Action bundle
- Caller-owned cache, artifact, notification, commit, and pull-request steps
- Tested desktop/mobile UI, reproducible builds, CI, and CodeQL

[Read the Action guide](https://github.com/derprofi1313/signal-scout#github-action)
· [Open the v0.2.0 release](https://github.com/derprofi1313/signal-scout/releases/tag/v0.2.0)

## How I build

- Evidence before claims
- Explicit boundaries for network and repository side effects
- Small, reviewable releases with tests and reproducible artifacts
- Useful vertical slices instead of disconnected demos
