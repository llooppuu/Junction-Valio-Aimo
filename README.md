# Trusted Trade Agents

An agent purchasing desk where professional kitchens hand food orders to AI purchasing agents that buy from a wholesaler within rules the kitchen sets.

## What it does

- **Dashboard**: approvals waiting, orders placed, quotes and agent runs at a glance, plus supplier delivery reliability.
- **Agent workspace**: per-kitchen agent with spending limits, stock alerts, a weekly standing order with drift checks, rules, the signed mandate and live activity.
- **Catalog**: product search with labels, allergens, stock, delivery dates, reliability and ranked substitutes.
- **Orders and activity**: placed orders and the append-only audit history of what agents and buyers did.
- **Wholesaler view**: the wholesaler's side, with every buyer's agents, waiting quotes and refused attempts.

All data is sample data in `src/data/mock.ts`. There is no backend.

## Quick start

Requires Node.js 22.12 or newer.

```sh
git clone <repository-url>
cd Junction-Valio-Aimo
npm install
npm run dev
```

Then open http://localhost:5173.

## Commands

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Start the Vite dev server with hot reload            |
| `npm run build`     | Type-check and build for production into `dist/`     |
| `npm run typecheck` | Type-check the project without building              |
| `npm run preview`   | Serve the production build locally                   |

## Project structure

```
public/          Static files served as-is (favicon)
src/
  main.tsx       Entry point: mounts the app and loads global styles
  App.tsx        Page shell: header, current view and footer
  components/    UI components: header, footer, views and building blocks
  lib/           Helpers and types: hash router, shell strings
  styles/        Design tokens, fonts, base and component CSS
```

## Tech stack

- React 19
- TypeScript (strict mode)
- Vite
- Plain CSS with design tokens as CSS variables
- Fonts from @fontsource: Barlow Condensed, Figtree, Source Serif 4
- Icons from lucide-react
