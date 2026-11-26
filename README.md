# Space of the Tourism

A three.js space-tourism game. HexGL's Feisar is catapulted out of Spaceport Aurora's launch bay, then you
fly through procedural star systems collecting passport stamps. The cockpit has 3D buttons for Space TV
(a YouTube episode on a pop-up screen), Boost, Hyperjump and Chromium.iso (a live Chromium in a Vercel
Sandbox VM, opened on Wikipedia's "Space" article).

## Layout

```
public/index.html      page, HUD, boarding pass, menu, 2D Chromium panel
public/js/main.js      bootstrap: Chromium client first, then the 3D game (dynamic import)
public/js/game.js      renderer, launch cinematic, flight model, HUD, screens, stamps, hyperjump
public/js/station.js   Spaceport Aurora: launch tube, bay door, ring, solar wings
public/js/planets.js   star systems; planet surfaces baked on the GPU (colour, height/roughness/lights, clouds)
public/js/cockpit.js   cabin, dashboard buttons, pop-up screens, bobblehead
public/js/hexgl.js     loader for HexGL's old three.js JSON models
public/js/iso.js       Chromium client: /api/vm boot, WebSocket frames, multi-touch input, 2D panel
public/js/audio.js     synthesized sound
api/vm.mjs             Vercel Function: resumes the "sott-chromium-iso" sandbox and starts the server
iso/server.mjs         Chromium server (BrowserHub from github.com/vendemiaraul-cyber/3d-browser)
iso/start.sh           starts the server inside the VM; fetches core.js from the pinned 3d-browser commit
scripts/vendor-hexgl.mjs  build step: copies the Feisar assets from github.com/BKcore/HexGL (MIT)
vercel.json            Vercel build: asset step, serves public/, /api/vm function (fra1)
netlify.toml           Netlify build: same static site, proxies /api/* to the Vercel deployment
```

## Deploy

- **Vercel** (game and Chromium.iso): import this repo as the `space-of-the-tourism` project and set the
  `ACCESS_KEY` environment variable. `vercel.json` does the rest.
- **Netlify** (the game as a static site): import this repo. `netlify.toml` builds `public/` and proxies
  `/api/*` to `https://space-of-the-tourism.vercel.app`, so Chromium.iso still boots on the Vercel plan.

No build tools are needed: the game is plain ES modules and loads three.js r186 from jsDelivr.

## Chromium.iso

`/api/vm` needs the `ACCESS_KEY` environment variable; open the game once as `/?key=YOUR_KEY` and the key is
remembered in that browser. The VM is a persistent named Vercel Sandbox (`sott-chromium-iso`, region fra1):
Chromium, fonts and node modules live in its snapshot, which never expires. Each boot resumes it, the
server streams the active tab with the CDP screencast (capped at 15 fps), and the VM stops on its own
timeout once nobody keeps it alive. Hobby limits Sandbox sessions to 45 minutes and 10 concurrent sandboxes.

Run the server locally instead: `npm i puppeteer ws && CHROMIUM_PATH=/path/to/chrome node iso/server.mjs`,
then open the game with `?iso=ws://127.0.0.1:3000/api/ws`.

## Credits

Feisar ship model, textures and booster: HexGL by Thibaut Despoulain, MIT licence. Space TV embeds official
uploads by Erik Wernquist ("Wanderers") and Kurzgesagt (The Fermi Paradox, parts 1 and 2).
