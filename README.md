# Salus IT600 for Homey

Control and monitor your Salus IT600 smart home devices locally through Homey via the UG600/UGE600 gateway.

## About

This Homey app integrates Salus IT600 smart home devices using **local network communication** - no cloud required. All communication happens directly between your Homey and the Salus gateway on your local network.

This app is a port of the excellent [pyit600](https://github.com/epoplavskis/pyit600) Python library and [Home Assistant integration](https://github.com/epoplavskis/homeassistant_salus) by Edgars Poplavskis.

## Supported Devices

### Thermostats
- HTRP-RF(50)
- TS600
- VS10WRF / VS10BRF
- VS20WRF / VS20BRF
- SQ610 / SQ610RF
- FC600

### Binary Sensors
- SW600 (Door/Window)
- WLS600 (Water Leak)
- OS600 (Occupancy)
- SD600 (Smoke) *
- TRV10RFM (Heating state only)
- RX10RF (Heating state only)

*\* SD600 may not always be detected due to gateway limitations*

### Temperature Sensors
- PS600

### Switch Devices
- SPE600 (Smart Plug with Energy)
- RS600 (Relay)
- SR600

### Cover Devices
- RS600 (Roller Shutter)

### Untested Devices
These devices may work but have not been tested:
- SP600 (Smart Plug)
- MS600 (Motion Sensor)

### Unsupported Devices
Buttons only work within the Salus Smart Home app:
- SB600
- CSB600

## Requirements

- **Homey Pro** (local apps require Homey Pro)
- **Salus UG600 or UGE600 gateway** connected to your local network
- **Local WiFi Mode enabled** on the gateway (see Setup below)

## Setup

### 1. Enable Local WiFi Mode

Before adding devices to Homey, you must enable local network access on your Salus gateway:

1. Open the **Salus Smart Home** app on your phone
2. Sign in to your account
3. Double tap your **Gateway** to open the info screen
4. Press the **gear icon** to enter configuration
5. Scroll down and ensure **"Disable Local WiFi Mode"** is set to **"No"**
6. Scroll to the bottom and **save settings**
7. **Restart the gateway** by unplugging/plugging the USB power

### 2. Find Your Gateway Information

You'll need two pieces of information:

- **Gateway IP Address**: Find this in your router's connected devices list, or in the Salus app gateway info screen
- **Gateway EUID**: A 16-character hex code printed on the bottom of your gateway (e.g., `001E5E0D32906128`)

### 3. Add Devices in Homey

1. Open the **Homey app**
2. Go to **Devices** and tap **+** to add a device
3. Select **Salus IT600**
4. Choose the device type you want to add (Thermostat, Sensor, etc.)
5. Enter your gateway's **IP address** and **EUID**
6. Select the devices you want to add

## App Settings

You can view and update your gateway connection settings at any time:

**Homey app > More > Apps > Salus IT600 > Settings**

## Features

### Thermostat
- Current and target temperature control
- Humidity monitoring (where supported)
- Battery level monitoring
- HVAC mode control (Off, Heat, Cool, Auto)
- Preset modes (Follow Schedule, Permanent Hold, Temporary Hold, Eco, Off)

### Binary Sensors
- Contact alarm (open/closed state)
- Automatic device class detection (door, window, moisture, smoke)

### Temperature Sensors
- Temperature monitoring

### Switches
- On/Off control

### Covers
- Open/Close/Stop control
- Position control (0-100%)

## Homey Flows

All capabilities support Homey Flows:

### Triggers (When...)
- Temperature changed
- Target temperature changed
- Thermostat mode changed
- Battery level changed
- Battery alarm
- Contact alarm changed
- Switch turned on/off
- Cover opened/closed

### Conditions (And...)
- Temperature is above/below
- Thermostat mode is
- Battery level is below
- Contact is open/closed
- Switch is on/off

### Actions (Then...)
- Set target temperature
- Set thermostat mode
- Set preset mode
- Turn switch on/off
- Open/Close/Stop cover
- Set cover position

## Troubleshooting

### Can't connect to gateway
- Verify the gateway IP address is correct
- Ensure Homey and the gateway are on the same network
- Check that "Disable Local WiFi Mode" is set to "No" in the Salus app
- Restart the gateway after changing settings

### EUID not working
- Try using `0000000000000000` (16 zeros) as a fallback EUID
- Verify you're reading the correct code from the gateway label

### Device not found during pairing
- Ensure the device is already paired in the official Salus Smart Home app
- The gateway must know about the device before Homey can discover it

### Battery not showing
- Battery level is only available on battery-powered thermostats
- Try removing and re-adding the device in Homey

## Technical Details

- **Communication**: Local HTTP to gateway on port 80
- **Encryption**: AES-256-CBC with key derived from gateway EUID
- **Polling**: Device status updated every 30 seconds
- **Platform**: Homey Pro only (local network apps)

## Contributing

If you want to help get your device supported:

1. Open a GitHub issue with your device model number
2. Include debug output if possible
3. Pull requests are welcome!

### For End Users

If you're looking for integrations with other platforms:
- **Home Assistant**: See [homeassistant_salus](https://github.com/epoplavskis/homeassistant_salus)
- **FHEM**: See [fhempy](https://github.com/dominikkarall/fhempy) which provides a subset of functionality

## Credits

This app is based on the work of:

- **[pyit600](https://github.com/epoplavskis/pyit600)** - Python client for Salus IT600 by Edgars Poplavskis
- **[homeassistant_salus](https://github.com/epoplavskis/homeassistant_salus)** - Home Assistant integration by Edgars Poplavskis

## Support

- **Issues**: [GitHub Issues](https://github.com/melmdk/io.github.melmdk.salus.it600/issues)
- **Source**: [GitHub Repository](https://github.com/melmdk/io.github.melmdk.salus.it600)

## License

This project is licensed under the **GNU General Public License v3.0** (GPL-3.0), the same license as the original [pyit600](https://github.com/epoplavskis/pyit600) project.

See [LICENSE](LICENSE) for details.
