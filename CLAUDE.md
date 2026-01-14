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

**Scopes:** `api`, `thermostat`, `sensor`, `switch`, `cover`, `pairing`, `flow`, `ci`

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
- AES-128-CBC encryption with PKCS7 padding
- Key derived from: `MD5("Salus-{euid.toLowerCase()}")` + 16 zero bytes
- Fixed IV: `[0x88, 0xa6, 0xb0, 0x79, 0x5d, 0x85, 0xdb, 0xfc, 0xe6, 0xe0, 0xb3, 0xe9, 0xa6, 0x29, 0x65, 0x4b]`
- All requests serialized (gateway handles few concurrent connections)

### Device Detection
| Device Type | API Attribute | Models |
|-------------|---------------|--------|
| Thermostat | `sIT600TH` or `sTherS` | TS600, SQ610, VS20WRF, FC600 |
| Temperature Sensor | `sTempS` | PS600 |
| Binary Sensor | `sIASZS` or `sBasicS` | SW600, OS600, WLS600, SD600 |
| Switch | `sOnOffS` | SPE600, RS600, SP600 |
| Cover | `sLevelS` | RS600 |

### Polling
- Default interval: 30 seconds
- State sync on capability changes

## File Structure

```
├── lib/
│   ├── salus-api.js      # API client (encryption, HTTP)
│   ├── device-types.js   # Device type mappings
│   └── constants.js      # Shared constants
├── drivers/
│   ├── thermostat/       # Climate control
│   ├── temperature-sensor/
│   ├── binary-sensor/    # Door/window/moisture/smoke
│   ├── switch/           # Smart plugs
│   └── cover/            # Blinds/shutters
└── .homeycompose/        # Homey Compose config
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

2. **Without hardware:**
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
- **EUID not working:** Try `0000000000000000` as fallback
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
1. Merge `develop` into `main`
2. Update version in `.homeycompose/app.json`
3. Create tag: `git tag v1.0.0`
4. Push tag: `git push origin v1.0.0`
5. GitHub Action publishes to Homey App Store

---

## Secrets Required

| Secret | Description |
|--------|-------------|
| `HOMEY_PAT` | Homey Personal Access Token for publishing |

Generate at: https://tools.developer.homey.app/
