# Polli source snapshots

| Package | Source | Commit |
| --- | --- | --- |
| `@samarinara/polli-ui` 0.2.0 | https://github.com/Samarinara/polli-ui/tree/main/packages/ui | `c031c1d962a169cc96e9496b2e93d97cf1c94f9f` |
| `@polli/platform-client` 0.1.0 | Samarinara/polli-platform, packages/client | `8c5440af531599bfe7fb696bf84010e9a3d96921` |
| `@polli/platform-server` 0.1.0 | Samarinara/polli-platform, packages/server | `8c5440af531599bfe7fb696bf84010e9a3d96921` |
| `@polli/platform-contracts` 0.1.0 | Samarinara/polli-platform, packages/contracts | `8c5440af531599bfe7fb696bf84010e9a3d96921` |

Manifests point to TypeScript source for bundling without private registry access. Platform client includes only the HTTP transport. Brownbag owns its payload cache and does not implement the platform's offline mutation queue. Polli UI retains its MIT license and notices.

`tests/platform/` contains unmodified migrations from the same platform commit as isolated fixtures. Never run them as Brownbag production migrations. Font TTFs are decompressed from the previously committed WOFFs; licenses live beside them.

Local compatibility patch: selection controls flatten style arrays before passing them through the web primitive. The original array caused a CSSStyleDeclaration error when rendering a shopping checkbox. The browser suite covers this path.
