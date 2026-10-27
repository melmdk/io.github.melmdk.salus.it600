# Salus IT600 Homey App - Development Guide

## Project Overview
Homey app for integrating Salus IT600 smart home devices via the local UG600/UGE600 gateway.

**App ID:** `io.github.melmdk.salus.it600`

---

## Development Guidelines

### Conventional Commits
All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Formatting, no code change
- `refactor` - Code change that neither fixes a bug nor adds a feature
- `test` - Adding or updating tests
- `chore` - Maintenance tasks, dependencies, CI

**Scopes:** `api`, `thermostat`, `sensor`, `switch`, `cover`, `wiring-centre`, `pairing`, `flow`, `ci`

**Examples:**
```
feat(thermostat): add preset mode support
fix(api): handle connection timeout gracefully
docs: update pairing instructions
chore(ci): add validation workflow
```

### Plans
Plans are stored in `plans/` and archived in `plans/archive/` when completed.

**Plan file format:**
- Name: `NNN-short-description.md` (e.g., `001-initial-implementation.md`)
- Include status, progress checkboxes, and technical details
- Update checkboxes as tasks are completed
- Move to `plans/archive/` when fully complete

### Code Style
- Use ES6+ syntax (async/await, arrow functions, destructuring)
- Use JSDoc comments for public APIs
- Keep files focused and under 300 lines when possible
- Use meaningful variable names (no single letters except loop indices)

### Error Handling
- Always catch and log errors with context
- Use `this.error()` in Homey classes
- Set devices unavailable on connection failures: `this.setUnavailable(message)`
- Recover gracefully when connection is restored

---

## Quick Commands

```bash
# Install dependencies
npm install

# Validate app structure
npx homey app validate

# Run locally (requires Homey Pro)
npx homey app run

# Publish to app store
npx homey app publish
```

## Architecture

### API Communication
- Local HTTP to gateway on port 80
- Protocols (`lib/protocol.ts`): AES-256-CBC, AES-128-CBC, AES-256-CCM (newer UG800 firmware)
- Detection (`IT600Gateway.connect()` in `lib/salus-api.ts`): stored protocol first, then cbc-256, cbc-128, ccm. The detected protocol is persisted in the app's `gateway` setting and reused on restart. Exception: a network error (or empty answer) on the stored protocol fails the connect without re-detecting; only an undecryptable or rejected answer re-detects
- CBC key: `MD5("Salus-{euid.toLowerCase()}")` + 16 zero bytes (256-bit); fixed IV `[0x88, 0xa6, 0xb0, 0x79, 0x5d, 0x85, 0xdb, 0xfc, 0xe6, 0xe0, 0xb3, 0xe9, 0xa6, 0x29, 0x65, 0x4b]`
- The app owns the one gateway connection; pairing and repair reuse it (`lib/pairing.ts`)
- One request lock shared by all `IT600Gateway` instances (gateway handles few concurrent connections)

### Device Detection
| Device Type | API Attribute | Models |
|-------------|---------------|--------|
| Thermostat | `sIT600TH` or `sTherS` | TS600, SQ610, VS20WRF, FC600 |
| Temperature Sensor | `sTempS` | PS600 |
| Binary Sensor | `sIASZS` or `sBasicS` | SW600, OS600, WLS600, SD600 |
| Switch | `sOnOffS` | SPE600, RS600, SP600 |
| Cover | `sLevelS` | RS600 |
| Wiring Centre | `sIT600WC` (or model `it600WC`) | it600WC |

### Polling
- Default interval: 30 seconds
- State sync on capability changes
- Combined `deviceid` requests (one request for all device types) are on by default (`combinedDetails` in the `gateway` setting). On a rejection, left-out devices or repeated failures the session falls back to per-type requests automatically. Users can switch them off with "Use combined device requests" in the app settings

## File Structure

```
├── app.ts                    # Owns the gateway connection, polling, settings
├── lib/
│   ├── salus-api.ts          # API client (detection, polling, writes)
│   ├── protocol.ts           # CBC-256 / CBC-128 / CCM protocols
│   ├── transport.ts          # HTTP transport (swapped for a fake in tests)
│   ├── parsers/              # Pure parsers: climate.ts, wiring-centre.ts, common.ts
│   ├── pairing.ts            # Pair/repair flow shared by all drivers
│   ├── gateway-settings.ts   # `gateway` setting shape, migration, error texts
│   ├── diagnostics.ts        # Problem alarm text and new-problem detection
│   ├── device-types.ts       # Device type mappings
│   └── constants.ts          # Shared constants
├── drivers/
│   ├── thermostat/           # Climate control
│   ├── temperature-sensor/
│   ├── binary-sensor/        # Door/window/moisture/smoke
│   ├── switch/               # Smart plugs
│   ├── cover/                # Blinds/shutters
│   └── wiring-centre/        # it600WC: connected, problems, signal
├── settings/index.html       # Gateway IP/EUID, combined requests, status
├── test/                     # node:test suite, fixtures, fake gateway
├── scripts/                  # Fixture capture and live checks (dev only)
└── .homeycompose/            # Homey Compose config
```

## Reference Materials

- **Homey SDK Docs:** `ref/apps.developer.homey.app/`
- **Salus Python Library:** `ref/pyit600/`
- **Home Assistant Integration:** `ref/homeassistant_salus/`

## Testing

1. **With real hardware:**
   - Need UG600/UGE600 gateway
   - Find EUID on gateway label (16 hex chars)
   - Enable "Local WiFi Mode" in Salus app

2. **Automated tests:**
   - `npm test` runs the `node:test` suite against sanitised gateway fixtures
   - `npm run capture` re-captures fixtures from the gateway in `test-config.json` (git-ignored, never commit the EUID)

3. **Without hardware:**
   - Validate structure: `npx homey app validate`
   - Check manifest: `npx homey app validate --level publish`

## Publishing

### From GitHub Actions
- Push tag `v*.*.*` triggers publish workflow
- Requires `HOMEY_APP_TOKEN` secret

### Manual
```bash
npx homey app publish
```

## Common Issues

- **Connection failed:** Check gateway IP and EUID
- **"No gateway answering at <ip>":** Host unreachable or wrong IP
- **"Wrong EUID: check the 16 characters on the gateway label":** Gateway answered but the EUID doesn't decrypt
- **EUID from the label rejected:** Some gateways accept `0000000000000000` if the label EUID is rejected
- **"Gateway firmware uses an encryption this app doesn't support":** Gateway rejects every known protocol
- **Device not found:** Ensure paired in official Salus app first

---

## Git Workflow

### Branches
- `main` - Production-ready code
- `develop` - Integration branch for features
- `feat/*` - Feature branches
- `fix/*` - Bug fix branches

### Pull Requests
- Create PR against `develop` for features
- Create PR against `main` for hotfixes
- Ensure `npx homey app validate` passes before merging
- Use squash merge with conventional commit message

### Releases

**Version files to update:**
| File | Purpose |
|------|---------|
| `.homeycompose/app.json` | Homey app version (primary) |
| `package.json` | npm package version |
| `CHANGELOG.md` | Release notes |

Note: `app.json` is auto-generated from `.homeycompose/app.json` via `npx homey app build`

**Release steps:**
1. Merge `develop` into `main`
2. Update version in all files listed above
3. Run `npx homey app build` to regenerate `app.json`
4. Commit: `git commit -m "chore: release vX.Y.Z"`
5. Create tag: `git tag -a vX.Y.Z -m "vX.Y.Z - Description"`
6. Push: `git push && git push origin vX.Y.Z`
7. GitHub Action publishes to Homey App Store

---

## Secrets Required

| Secret | Description |
|--------|-------------|
| `HOMEY_PAT` | Homey Personal Access Token for publishing |

Generate at: https://tools.developer.homey.app/
