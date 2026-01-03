# CLAUDE.md - FrostGuard LoRaWAN Device Emulator

This file provides context for Claude Code (or other AI assistants) working on this codebase.

## Project Overview

**FrostGuard LoRaWAN Device Emulator** is a full-stack development and testing tool for The Things Network (TTN) integration. It's a web-based simulator for LoRaWAN sensors integrated with Supabase backend, designed to test multi-tenant IoT data flow between FrostGuard (upstream project) and this emulator.

**Real-world context:** Simulates temperature/humidity/door sensors in refrigerator/freezer monitoring scenarios, integrating with TTN's LoRaWAN network infrastructure.

## Technology Stack

### Frontend
- **Framework:** React 18.3 + TypeScript 5.8
- **Build Tool:** Vite 5.4 with SWC compiler
- **Routing:** React Router v6
- **UI Library:** shadcn-ui (Radix UI components)
- **Styling:** Tailwind CSS 3.4 with CSS variables (HSL color system)
- **State Management:** TanStack React Query 5.x for data fetching
- **Forms:** React Hook Form + Zod validation
- **Charts:** Recharts
- **Icons:** Lucide React

### Backend
- **Database:** Supabase (PostgreSQL) with Row-Level Security (RLS)
- **Edge Functions:** Deno-based serverless functions (17 functions in `supabase/functions/`)
- **API Integration:** The Things Network (TTN) v3 HTTP API
- **Cross-project sync:** FrostGuard synchronization

## Quick Commands

```bash
# Development
npm install              # Install dependencies
npm run dev              # Start dev server (port 8080)

# Production
npm run build            # Production build
npm run build:dev        # Dev build with source maps
npm run preview          # Preview production build

# Linting
npm run lint             # Run ESLint
```

## Project Structure

```
src/
├── pages/               # Route pages (Index, DeviceEmulator, NotFound)
├── components/
│   ├── ui/              # shadcn-ui component library
│   └── emulator/        # Emulator-specific components
├── lib/                 # Business logic & utilities
│   ├── debugLogger.ts   # Debug logging system
│   ├── ttnConfigStore.ts # TTN config state management
│   ├── frostguardOrgSync.ts # FrostGuard API integration
│   └── ttn-payload.ts   # TTN types & utilities
├── hooks/               # Custom React hooks
└── integrations/supabase/ # Supabase client & types

supabase/
├── functions/           # 17 Deno edge functions
│   ├── ttn-simulate/    # Simulate uplinks to TTN
│   ├── ttn-preflight/   # Validate TTN config
│   ├── ttn-webhook/     # Receive TTN webhooks
│   ├── manage-ttn-settings/ # TTN connection testing
│   └── ...
└── migrations/          # Database migrations (16 files)
```

## Key Files & Entry Points

| File | Purpose |
|------|---------|
| `src/components/LoRaWANEmulator.tsx` | Main orchestrator component (1600+ LOC) |
| `src/components/emulator/WebhookSettings.tsx` | TTN configuration UI (1700+ LOC) |
| `src/components/emulator/DeviceManager.tsx` | Device management (1290 LOC) |
| `src/lib/ttnConfigStore.ts` | Centralized TTN config state |
| `src/lib/frostguardOrgSync.ts` | FrostGuard API integration |

## Coding Conventions

### TypeScript
- Use strict typing, especially in critical paths (RLS, TTN operations)
- Define interfaces for all data shapes
- Use discriminated unions for state management
- Types are auto-generated from Supabase schema in `src/integrations/supabase/types.ts`

### React Patterns
- Functional components with hooks only (no class components)
- Custom hooks for cross-cutting concerns (prefix: `use*`)
- React Query for server state management
- Error Boundary for error handling
- Hash-based routing with React Router

### Styling
- Tailwind CSS utility-first approach
- CSS variables in HSL format (defined in `src/index.css`)
- Use `cn()` utility from `src/lib/utils.ts` for conditional classes
- Dark mode support via CSS class

### Naming
- **Components:** PascalCase (`DeviceManager.tsx`)
- **Functions/Variables:** camelCase
- **Constants:** UPPER_SNAKE_CASE
- **Hooks:** `use*` prefix
- **Log Events:** UPPER_SNAKE_CASE (`TTN_CONFIG_LOADED`)

## Architecture Notes

### Multi-Tenant Design
- User context selection via `UserSelectionGate.tsx`
- Organization-scoped TTN settings
- FrostGuard sync for canonical data (sites, units, sensors)
- Session storage for user context (1-hour expiry)

### TTN Configuration Flow
1. Canonical config pulled from FrostGuard via `fetch-org-state` edge function
2. Local draft config for UI edits (stored in sessionStorage)
3. Conflict resolution: local dirty tracking prevents overwrites
4. Two sources: `synced_users.ttn` (user-level) + `ttn_settings` (org-level fallback)

### State Management
- `ttnConfigStore.ts` - Centralized config with listener pattern
- Session storage for TTN config persistence
- React Query for server state
- Props-based composition for local state

## Edge Functions

All edge functions are in `supabase/functions/`. Key patterns:
- CORS headers on all functions
- Service role key for elevated access
- `verify_jwt = false` in config (handled manually)
- Request ID propagation for debugging

### Common Edge Functions
| Function | Purpose |
|----------|---------|
| `ttn-simulate` | Send simulated uplinks to TTN |
| `ttn-preflight` | Validate TTN config before simulation |
| `ttn-webhook` | Receive webhook callbacks from TTN |
| `manage-ttn-settings` | Test TTN API connection |
| `fetch-org-state` | Pull data from FrostGuard |
| `sync-to-frostguard` | Push data to FrostGuard |

## Known Issues & Technical Debt

### Critical (P0)
- RLS policies on `ttn_settings` table need security review (migration fix exists)

### Important (P1)
- Inconsistent response envelopes across edge functions
- Multiple sources of truth for TTN config
- FrostGuard sync disabled for TTN settings

### Nice-to-Have (P2)
- Monolithic components (split large files like `LoRaWANEmulator.tsx`)
- Debug logging consolidation needed
- Dead code cleanup

See `FROSTGUARD_AUDIT_REPORT.md` for detailed audit findings.

## Testing

**No testing framework is currently configured.** All testing is manual.

If adding tests:
- Recommend Vitest for unit tests (Vite-native)
- React Testing Library for component tests
- Consider Playwright for E2E tests

## Environment Variables

Required in `.env`:
```
VITE_SUPABASE_URL=<supabase-project-url>
VITE_SUPABASE_ANON_KEY=<supabase-anon-key>
```

## Development Tips

1. **Path alias:** Use `@/` to import from `src/` (e.g., `@/components/ui/button`)
2. **Debug logging:** Use `debugLogger` from `@/lib/debugLogger` for consistent logging
3. **Error messages:** Use `errorExplainer` from `@/lib/errorExplainer` for user-friendly TTN errors
4. **UI components:** Check `src/components/ui/` before creating new components - shadcn has 30+ ready to use
5. **Supabase types:** Run Supabase CLI to regenerate types after schema changes

## Related Documentation

- `README.md` - Basic setup instructions
- `TTN_SYNC_SETUP.md` - Detailed TTN integration guide
- `FROSTGUARD_AUDIT_REPORT.md` - Comprehensive architecture audit
