# ClimbCheck — Koch Chart Calculator (RC 6.4.2)

A runway & density altitude performance tool with decoded METAR, dual DA models (Rule‑of‑thumb vs Precise), and a visual runway usage display.

## Dev Quickstart
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Deploy (Vercel)
- Framework: **React**
- Build command: `npm run build`
- Output directory: `dist`

## Notes
- METAR fetch uses a public CORS proxy by default. For reliability, consider using your own Cloudflare Worker proxy and set the `proxy` URL in `App.tsx`.
- Advisory use only. Verify with AFM/POH & official weather products.