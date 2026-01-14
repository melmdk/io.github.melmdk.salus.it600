# Plan: Salus IT600 Homey App - Initial Implementation

**Status:** In Progress
**Created:** 2026-01-14

## Overview
Create a Homey app to integrate Salus IT600 smart home devices via the local UG600/UGE600 gateway API.

- **App ID:** `io.github.melmdk.salus.it600`
- **Language:** TypeScript
- **Supported Devices:** Thermostats, temperature sensors, binary sensors, switches, covers

---

## Progress

### Phase 1: Project Setup
- [x] Create CLAUDE.md
- [x] Create plans directory structure
- [x] Create `package.json`
- [x] Create `.homeycompose/app.json` manifest
- [x] Create `.gitignore`
- [x] Create `tsconfig.json`
- [x] Create `.eslintrc.json`
- [x] Create `app.ts` (skeleton)
- [x] Create `assets/icon.svg`

### Phase 2: GitHub Actions
- [x] Create `.github/workflows/homey-app-validate.yml`
- [x] Create `.github/workflows/homey-app-publish.yml`
- [x] Create `.github/workflows/homey-app-version.yml`

### Phase 3: Core Library
- [ ] Create `lib/constants.ts` - Shared constants, IV, device mappings
- [ ] Create `lib/salus-api.ts` - API client with AES encryption
- [ ] Create `lib/device-types.ts` - Device type detection and mapping

### Phase 4: Main App
- [ ] Update `app.ts` - Add shared API client and gateway management

### Phase 5: Drivers
- [ ] **Thermostat driver**
  - [ ] `drivers/thermostat/driver.compose.json`
  - [ ] `drivers/thermostat/driver.ts`
  - [ ] `drivers/thermostat/device.ts`
  - [ ] `drivers/thermostat/assets/icon.svg`
- [ ] **Temperature sensor driver**
  - [ ] `drivers/temperature-sensor/driver.compose.json`
  - [ ] `drivers/temperature-sensor/driver.ts`
  - [ ] `drivers/temperature-sensor/device.ts`
  - [ ] `drivers/temperature-sensor/assets/icon.svg`
- [ ] **Binary sensor driver**
  - [ ] `drivers/binary-sensor/driver.compose.json`
  - [ ] `drivers/binary-sensor/driver.ts`
  - [ ] `drivers/binary-sensor/device.ts`
  - [ ] `drivers/binary-sensor/assets/icon.svg`
- [ ] **Switch driver**
  - [ ] `drivers/switch/driver.compose.json`
  - [ ] `drivers/switch/driver.ts`
  - [ ] `drivers/switch/device.ts`
  - [ ] `drivers/switch/assets/icon.svg`
- [ ] **Cover driver**
  - [ ] `drivers/cover/driver.compose.json`
  - [ ] `drivers/cover/driver.ts`
  - [ ] `drivers/cover/device.ts`
  - [ ] `drivers/cover/assets/icon.svg`

### Phase 6: Custom Capabilities & Flow Cards
- [ ] Create `.homeycompose/capabilities/salus_preset_mode.json`
- [ ] Flow action cards (auto-generated from capabilities)
- [ ] Flow trigger cards (auto-generated from capabilities)

### Phase 7: Assets & Localization
- [ ] Create `assets/images/small.png` (250x175)
- [ ] Create `assets/images/large.png` (500x350)
- [ ] Create `assets/images/xlarge.png` (1000x700)
- [ ] Update `locales/en.json` with translations

### Phase 8: Validation & Testing
- [ ] Run `npm run build` (TypeScript compile)
- [ ] Run `npm run lint`
- [ ] Run `npx homey app validate`
- [ ] Run `npx homey app validate --level publish`

---

## Technical Details

### Encryption (AES-128-CBC)
```typescript
const IV = Buffer.from([0x88, 0xa6, 0xb0, 0x79, 0x5d, 0x85, 0xdb, 0xfc,
                        0xe6, 0xe0, 0xb3, 0xe9, 0xa6, 0x29, 0x65, 0x4b]);

function deriveKey(euid: string): Buffer {
  const hash = crypto.createHash('md5')
    .update(`Salus-${euid.toLowerCase()}`)
    .digest();
  return Buffer.concat([hash, Buffer.alloc(16)]);
}
```

### Device Type Detection
| Attribute | Device Type |
|-----------|-------------|
| `sIT600TH` or `sTherS` | Thermostat |
| `sTempS` | Temperature Sensor |
| `sIASZS` or `sBasicS` | Binary Sensor |
| `sOnOffS` | Switch |
| `sLevelS` | Cover |

### Thermostat Capabilities
- `measure_temperature` - Current temp
- `target_temperature` - Target (5-35°C, 0.5 step)
- `measure_humidity` - If supported
- `thermostat_mode` - off, heat, cool, auto
- `salus_preset_mode` - Follow Schedule, Permanent Hold, Temporary Hold, Eco

---

## Files to Create

| File | Purpose |
|------|---------|
| `lib/constants.ts` | Constants, IV, device models |
| `lib/salus-api.ts` | API client with encryption |
| `lib/device-types.ts` | Device type detection |
| `drivers/thermostat/*` | Thermostat driver |
| `drivers/temperature-sensor/*` | Temperature sensor driver |
| `drivers/binary-sensor/*` | Binary sensor driver |
| `drivers/switch/*` | Switch driver |
| `drivers/cover/*` | Cover driver |
| `.homeycompose/capabilities/*` | Custom capabilities |
