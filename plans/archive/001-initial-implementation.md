# Plan: Salus IT600 Homey App - Initial Implementation

**Status:** Complete
**Created:** 2026-01-14
**Completed:** 2026-01-14

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
- [x] Create `lib/constants.ts` - Shared constants, IV, device mappings
- [x] Create `lib/salus-api.ts` - API client with AES encryption
- [x] Create `lib/device-types.ts` - Device type detection and mapping

### Phase 4: Main App
- [x] Update `app.ts` - Add shared API client and gateway management

### Phase 5: Drivers
- [x] **Thermostat driver**
  - [x] `drivers/thermostat/driver.compose.json`
  - [x] `drivers/thermostat/driver.ts`
  - [x] `drivers/thermostat/device.ts`
  - [x] `drivers/thermostat/assets/icon.svg`
- [x] **Temperature sensor driver**
  - [x] `drivers/temperature-sensor/driver.compose.json`
  - [x] `drivers/temperature-sensor/driver.ts`
  - [x] `drivers/temperature-sensor/device.ts`
  - [x] `drivers/temperature-sensor/assets/icon.svg`
- [x] **Binary sensor driver**
  - [x] `drivers/binary-sensor/driver.compose.json`
  - [x] `drivers/binary-sensor/driver.ts`
  - [x] `drivers/binary-sensor/device.ts`
  - [x] `drivers/binary-sensor/assets/icon.svg`
- [x] **Switch driver**
  - [x] `drivers/switch/driver.compose.json`
  - [x] `drivers/switch/driver.ts`
  - [x] `drivers/switch/device.ts`
  - [x] `drivers/switch/assets/icon.svg`
- [x] **Cover driver**
  - [x] `drivers/cover/driver.compose.json`
  - [x] `drivers/cover/driver.ts`
  - [x] `drivers/cover/device.ts`
  - [x] `drivers/cover/assets/icon.svg`

### Phase 6: Custom Capabilities & Flow Cards
- [x] Create `.homeycompose/capabilities/salus_preset_mode.json`
- [x] Flow action cards (auto-generated from capabilities)
- [x] Flow trigger cards (auto-generated from capabilities)

### Phase 7: Assets & Localization
- [x] Create `assets/images/small.png` (250x175)
- [x] Create `assets/images/large.png` (500x350)
- [x] Create `assets/images/xlarge.png` (1000x700)
- [x] Create driver images (75x75, 500x500, 1000x1000)
- [x] Update `locales/en.json` with translations

### Phase 8: Validation & Testing
- [x] Run `npm run build` (TypeScript compile)
- [x] Run `npx homey app validate`
- [x] Run `npx homey app validate --level publish`

---

## Summary

Successfully implemented a complete Homey app for Salus IT600 devices with:

- **5 device drivers:** thermostat, temperature-sensor, binary-sensor, switch, cover
- **Core library:** AES encryption, device discovery, command methods
- **Custom capability:** salus_preset_mode for thermostat presets
- **GitHub Actions:** Pre-configured for validation and publishing
