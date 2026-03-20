# Garmin to ZWO Converter

Use your Workout from Garmin Connect anywhere else with the .zwo export functionaliry added by this extension. 

## News
The extension is now available in the Firefox Add-ons Library. 🥳

## Features

- Injects a "Download .zwo" button directly into the Garmin Connect workout editor
- Converts structured workouts (steps, intervals, repeats) to ZWO XML format
- Maps Garmin power zones (Z1–Z7) to fractional FTP values
- Handles lap-button / open-ended steps as `<FreeRide>` blocks
- Supports cycling, running, swimming, and walking sport types
- Works with both English and German Garmin Connect UI labels
- Handles Garmin Connect's SPA navigation — re-injects the button on workout changes

## Zone Power Mapping

| Zone | FTP Fraction |
|------|-------------|
| Z1   | 0.55        |
| Z2   | 0.68        |
| Z3   | 0.83        |
| Z4   | 0.95        |
| Z5   | 1.08        |
| Z6   | 1.20        |
| Z7   | 1.50        |

## Installation

No build step required — the extension runs directly from source.

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **"Load unpacked"** and select the project folder.

Works in Chrome, Edge, Brave, and other Chromium-based browsers as well as in Browsers from from the Firefox-family.

## Usage

1. Open a workout on Garmin Connect: `https://connect.garmin.com/app/workout/<id>`
2. Wait for the blue **"Download .zwo"** button to appear in the workout editor header.
3. Click the button — a `.zwo` file named after your workout is downloaded.
4. Place the file in your Zwift workouts folder:
   `Documents/Zwift/Workouts/<your-id>/` or use it anywhere else.
