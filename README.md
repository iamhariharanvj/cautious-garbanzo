# For Jaanu — A Dream for You

A romantic, dreamy 3D experience: a **boat on the ocean at night** under a starry sky. Whistle (or press K) to bring the boat to life—lanterns rise, fireworks burst, and “Happy Birthday Jaanu!” appears in the stars. Move around the boat and enjoy the moment.

## How to run

The game needs to be served over HTTP (or localhost) for the microphone to work.

```bash
npx serve .
```

Then open **http://localhost:3000** in your browser. Allow microphone access when prompted (used only for the whistle moment).

## How to play

1. **Enter** — Click "Enter" on the title screen.
2. You are in a **romantic row boat** on a starry ocean. **Whistle** (or make a sustained high sound) into your microphone—or press **K** to test without a mic.
3. The **magic reveals itself**: floating lanterns, candles, and balloons rise; fireworks burst; candle sparkles and fireflies appear; the stars form “Happy Birthday Jaanu!” and a flower “named after you” blooms.
4. **Move around the boat** with WASD and the mouse. Stay as long as you like.

## Controls

- **W A S D** — Move (after the boat appears)
- **Mouse / touch drag** — Look around
- **K** — Trigger the magic without whistling (for testing)

## Tech

- **Three.js** (via CDN) for 3D, bloom, and soft lighting
- **Web Audio API** for whistle detection and ambient sound
- No build step: serve the folder and open in a browser

Made with love.
