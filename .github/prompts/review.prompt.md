# GitHub Copilot — Code Review Instructions

> These instructions are applied automatically whenever `/review` is used
> or when Copilot is asked to review any code in this repository.

---

## Step 1 — Stack Detection

Before anything else, identify and explicitly state:

| Field     | Value                                       |
| --------- | ------------------------------------------- |
| Layer     | `FRONTEND` · `BACKEND` · `FULLSTACK`        |
| Language  | e.g. TypeScript, Python, Go                 |
| Framework | e.g. React 18, Next.js 14, Express, FastAPI |
| Runtime   | e.g. Node 20, Python 3.11                   |

**If FRONTEND**, additionally detect all styling approaches present in the file:

| Library                     | Detection Signal                                                |
| --------------------------- | --------------------------------------------------------------- |
| Tailwind CSS                | `className` with utility classes (`flex`, `p-4`, `text-sm`, …)  |
| styled-components / Emotion | `styled.div\`\``, `css\`\``, `@emotion` imports                 |
| CSS Modules / Plain CSS     | `styles.xxx`, `import *.module.css`, or separate `.css` imports |
| MUI / Ant Design / Shadcn   | `<Button />`, `<Stack />`, `sx={{}}`, `<Card />`                |

List **every** approach found. If more than one is detected in the same file:

```
⚠️  Mixed styling detected: [Tailwind + MUI] — verify this is intentional before proceeding.
```

---

## Step 2 — Universal Checks _(always run, regardless of layer)_

### 2.1 Critical Issues `[MUST FIX]`

Bugs, broken logic, or anything that causes failures, data loss, or security breaches in production.

For each issue found, use this format:

```
📍 Location : [function name / line number]
🔴 Problem  : [clear description of what is wrong]
💥 Impact   : [what breaks or fails as a result]
✅ Fix      : [corrected code snippet]
```

### 2.2 Warnings `[SHOULD FIX]`

Non-critical issues that introduce technical debt, subtle bugs, or maintainability problems.
Use the same format as 2.1.

### 2.3 Code Quality

Evaluate and report on each of the following:

- **DRY** — identify duplicated logic that should be abstracted
- **Naming** — are variables, functions, and files named clearly and consistently?
- **Error handling** — is it present, consistent, and complete across all code paths?
- **Separation of concerns** — is business logic mixed with UI or routing?
- **SOLID violations** — call out any clear violations with a suggested fix
- **Complexity** — flag functions exceeding ~20 lines or with deeply nested conditions

### 2.4 Strengths

List **3–5 genuine strengths** in the code.
Be specific — reference actual function names, patterns, or decisions. No filler praise.

### 2.5 Prioritized Action Plan

End every review with a numbered to-do list ordered strictly by priority:

```
1. [Critical]     ...
2. [Critical]     ...
3. [Should Fix]   ...
4. [Should Fix]   ...
5. [Nice to Have] ...
```

---

## Step 3 — Frontend Checks _(skip entirely if BACKEND)_

### 3.1 UI & States

- Missing `loading` state on any async operation
- Missing `error` state with user-facing feedback
- Missing `empty` state on lists or data-dependent views
- Forms: client-side validation present and surfacing errors correctly?

### 3.2 Accessibility `(a11y)`

- Missing `alt` on images, `aria-label` on icon buttons, `role` where needed
- Keyboard navigation: all interactive elements reachable and operable?
- Focus management: modals, drawers, and dialogs trapping focus correctly?
- Color contrast: does it meet WCAG AA (4.5:1 for text, 3:1 for UI components)?

### 3.3 Performance

- Unnecessary re-renders — identify components re-rendering on unrelated state changes
- Missing `useMemo` / `useCallback` / `React.memo` on expensive computations or stable references
- Heavy imports not code-split — flag any library imported in full that should be lazy-loaded
- Images: missing `loading="lazy"`, wrong format for context, no `width`/`height` causing layout shift

### 3.4 State Management

- Prop drilling beyond 2 levels — suggest Context, Zustand, or co-location
- Stale closures in `useEffect`, `setTimeout`, or event handlers
- Race conditions in concurrent async state updates
- Derived state computed in render rather than memoized

### 3.5 Styling Review

Run **only the blocks matching detected libraries**:

---

#### Tailwind CSS

- `className` strings exceeding 6–8 utilities inline
  → suggest extracting to a named component or using `cn()` / `clsx()`
- Arbitrary values (`w-[347px]`, `text-[13px]`)
  → suggest standard Tailwind scale or a CSS custom property
- Responsive prefixes (`sm:`, `md:`, `lg:`) missing where layout clearly requires them
- Dark mode: `dark:` prefix absent on color and background utilities
- `!important` overrides — flag as a specificity smell

---

#### styled-components / Emotion

- Hardcoded color or spacing values inside template literals
  → replace with theme tokens (`theme.colors.primary`, `theme.spacing(2)`)
- Dynamic styles defined inside the component body
  → move static styles outside the component to avoid re-creating styled components on every render
- `createGlobalStyle` used for component-scoped styles — should be scoped instead
- Theme not consumed via `useTheme()` or `ThemeProvider` where tokens exist

---

#### CSS Modules / Plain CSS

- Magic pixel values — suggest `rem`, `em`, or CSS custom properties
- Missing responsive `@media` breakpoints where layout depends on viewport
- Overly specific or deeply nested selectors — flatten to reduce fragility
- Global styles leaking into component scope
- Unused class names that bloat the stylesheet

---

#### MUI / Ant Design / Shadcn

- `sx={{}}` overrides fighting the design system
  → prefer `variant`, `size`, `color` props the component already exposes
- Custom CSS targeting component internals (e.g. `.MuiButton-root`)
  → use the `slots` API or `styled()` wrapper for stability
- Accessibility props the component accepts but are not passed
  (`aria-label`, `inputProps`, `componentsProps`, `getOptionLabel`, etc.)
- Inline `style={{}}` on MUI components — `sx` or `styled()` is the correct approach

---

#### Cross-Library Conflict Checks _(run whenever more than one library is detected)_

| Conflict                     | What to look for                                                | Recommended fix                                                                                        |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Tailwind + MUI/Shadcn        | Tailwind `preflight` resetting MUI base styles                  | Add `@layer` ordering or use `important` strategy in `tailwind.config`                                 |
| Tailwind + MUI               | Tailwind utilities not applying due to MUI's higher specificity | Use `StyledEngineProvider injectFirst` or CSS variable tokens                                          |
| styled-components + Tailwind | CSS-in-JS styles overridden by utility classes                  | Establish clear ownership: layout → Tailwind, component internals → styled                             |
| CSS Modules + Tailwind       | Specificity wars between scoped classes and utilities           | Enforce a rule: one system owns each concern per component                                             |
| Any mix                      | Multiple sources of truth for spacing or color tokens           | Flag token divergence; recommend a single design token source (CSS variables or a shared theme object) |

---

## Step 4 — Backend Checks _(skip entirely if FRONTEND)_

### 4.1 Security

State overall risk level: `Low` · `Medium` · `High` · `Critical`

Check and report on every item:

- [ ] SQL / NoSQL injection — are all queries parameterized or using a safe ORM?
- [ ] Authentication — is auth middleware applied to all protected routes?
- [ ] Authorization — IDOR or privilege escalation possible?
- [ ] Sensitive data in responses — passwords, tokens, or PII returned to clients?
- [ ] Hardcoded secrets or API keys in source
- [ ] Input validation — all incoming data validated and sanitized before use?
- [ ] Mass assignment — are model fields explicitly whitelisted?
- [ ] Rate limiting — present and not trivially bypassable?
- [ ] CORS — origin whitelist configured correctly, not set to `*` in production?
- [ ] HTTPS — any plain HTTP references or insecure redirects?

### 4.2 Database & Queries

- **N+1 problems** — identify every case; show the fix with eager loading
- **Missing indexes** — flag fields used in `WHERE`, `ORDER BY`, or `JOIN` without indexes
- **Transactions** — are they used wherever multiple writes must be atomic?
- **Raw queries** — if used, are they fully parameterized with no string concatenation?
- **Pagination** — enforced on all list endpoints? No unbounded queries?
- **Soft vs hard delete** — is the approach consistent across the codebase?

### 4.3 API Design

- Correct HTTP methods (`GET` reads, `POST` creates, `PUT`/`PATCH` updates, `DELETE` removes)
- Status codes match semantics (`201` on create, `204` on empty success, `422` on validation failure, etc.)
- Error responses follow a consistent structure (e.g. `{ error: { code, message, details } }`)
- Versioning strategy present (`/v1/`, `Accept` header, etc.)?
- Any endpoint design that risks a breaking change for existing consumers?

### 4.4 Performance

- Blocking synchronous I/O that should be async — flag with suggested async alternative
- Missing caching on expensive or frequently repeated operations
- Connection pooling: is it configured? Is the pool size appropriate?
- Expensive operations triggered on every request that could be moved to a background job

### 4.5 Logging & Observability

- Errors logged with sufficient context: user ID, request ID, stack trace?
- Sensitive fields (`password`, `token`, `card_number`) excluded from all log output?
- Slow queries or failed external API calls captured?
- Structured logging used (JSON) rather than unformatted strings?

---

## Output Format

Every review must follow this exact structure:

```
## Detected Stack
[table]

## Critical Issues
[findings or "None found"]

## Warnings
[findings or "None found"]

## Code Quality
[findings]

## Frontend Review     ← omit if BACKEND
[findings]

## Backend Review      ← omit if FRONTEND
[findings]

## Strengths
[3–5 items]

## Action Plan
[numbered priority list]
```

Keep language precise and direct.
Do not add filler, summaries, or motivational closing remarks.
Every finding must reference a specific location in the code.
