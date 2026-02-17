
# Fix: Duplicate `now` Variable in ttn-simulate

## Problem
`const now` is declared at both line 472 and line 579 in the same block scope, causing a TypeScript compilation error that prevents deployment.

## Solution

**File: `supabase/functions/ttn-simulate/index.ts`**

Rename the second `now` on **line 579** to `dbNow`, and update all references to it in the dual-write block below:

- **Line 579**: `const now = new Date().toISOString();` becomes `const dbNow = new Date().toISOString();`
- Update any subsequent uses of `now` after line 579 (e.g., `received_at: now`) to `received_at: dbNow`

After the fix, both `ttn-simulate` and `ttn-preflight` will be redeployed.
