---
name: vsdr-devops
description: "DevOps workflow skill for the VSDR project. Use this skill whenever deploying code, committing changes, managing branches, checking deployment status, debugging build failures, managing domains or SSL, monitoring uptime or performance, or doing any git or Vercel-related task for the VSDR project. Also trigger when the user says 'deploy', 'push', 'ship it', 'go live', 'is the site up', 'check production', 'create a branch', 'merge', or asks about build errors, deploy previews, or rollbacks. Also use for: planning new features, troubleshooting bugs, adding functionality, amending existing features, tracking change requests, or any code modification task."
---

# VSDR DevOps & Development Skill

You are Gaby, the AI agent responsible for planning, building, deploying, and maintaining the VSDR (Safira) platform. This skill covers the complete development lifecycle: from change requests through to production deployment.

---

## 1. Project Architecture

### Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS (no framework)
- **Animations:** GSAP 3 + ScrollTrigger (CDN)
- **Backend:** Supabase PostgreSQL (REST API, no SDK)
- **Auth:** Supabase Auth (email/password)
- **Hosting:** Vercel (auto-deploys from `main` branch)
- **Serverless:** Vercel Functions (`/api/` directory)
- **Sync:** Airtable bi-directional sync via `/api/airtable-sync.js`

### Repository
- **GitHub:** `gaby-sprintly/sprintly-vsdr`
- **Main branch:** `main` (production — auto-deploys to Vercel)
- **Production URL:** `vsdr.vercel.app`

### Key Files
```
sprintly-vsdr/
├── *.html              # 18+ pages (each is standalone)
├── css/
│   └── design-system.css   # Shared tokens, sidebar, components
├── js/
│   ├── supabase-client.js  # Supabase API wrapper (CRUD)
│   ├── auth.js             # Auth (login, session, token refresh)
│   └── sidebar.js          # Navigation + theme toggle
├── api/
│   └── airtable-sync.js    # Vercel serverless function
├── goals-data.json         # Goals data (version-controlled)
├── projects-data.json      # Pipeline projects data
├── network-data.json       # Contact network data
└── vercel.json             # Vercel config + security headers
```

### Data Version System
- `goals-data.json` has a `version` field (currently `4`)
- localStorage caches goals data with version check
- **CRITICAL:** Always bump `version` when editing `goals-data.json` seed data
- The frontend force-clears localStorage on every load to prevent stale data bugs

---

## 2. Development Workflow

### Standard Change Process

**Step 1: Plan**
```
1. Understand the change request
2. Identify which files need modification
3. Read those files to understand current implementation
4. Design the approach (use EnterPlanMode for non-trivial changes)
```

**Step 2: Branch**
```bash
# Create a worktree branch for isolation
# Or work directly on a feature branch
git checkout -b feature/<short-description>
```

**Step 3: Build**
```
1. Make code changes
2. Follow the existing design system (CSS variables, component patterns)
3. Use vanilla JS — no frameworks, no npm packages
4. Use GSAP for animations (gsap.fromTo with clearProps — NEVER gsap.from)
5. Test locally if possible
```

**Step 4: Commit**
```bash
git add <specific-files>
git commit -m "Short description of what and why

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

**Step 5: Push & PR**
```bash
git push -u origin feature/<branch-name>
gh pr create --title "Title" --body "## Summary\n- Change 1\n- Change 2\n\n## Test plan\n- [ ] Test 1"
```

**Step 6: Merge & Deploy**
```bash
gh pr merge <number> --merge
# Vercel auto-deploys from main within 1-2 minutes
```

---

## 3. Common Development Patterns

### Adding a New Page
1. Create `newpage.html` following the template of any existing page
2. Include the standard head (CSP, fonts, design-system.css)
3. Add `<script src="js/supabase-client.js">`, `auth.js`, `sidebar.js`
4. Call `initSidebar('pagename')` in a script tag
5. Add the page to `js/sidebar.js` nav items array
6. Follow the `.main > .main-inner` content structure

### Adding a New Feature to an Existing Page
1. Read the current page file completely
2. Add CSS in the existing `<style>` block (page-specific styles)
3. Add HTML in the `<body>` section
4. Add JS in the existing `<script>` block
5. Follow existing naming conventions and patterns

### Modifying Goals Data
1. Edit `goals-data.json`
2. Bump the `version` number (e.g., 4 → 5)
3. Commit and deploy — localStorage auto-clears on version mismatch

### Adding a Supabase Query
```javascript
// Read
var contacts = await sbGet('contacts', 'select=id,first_name,last_name&vip=eq.true&limit=20');

// Insert
var result = await sbInsert('contacts', {
  first_name: 'Kate',
  last_name: 'Smith',
  company: 'CloudCom'
}, { returnData: true });

// Update
await sbUpdate('contacts', 'id=eq.' + contactId, { vip: true });

// Delete
await sbDelete('contacts', 'id=eq.' + contactId);
```

---

## 4. GSAP Animation Rules

**CRITICAL: Never use `gsap.from()` — always use `gsap.fromTo()`**

Elements animated with `gsap.from({ opacity: 0 })` can get stuck invisible if the animation is interrupted. This caused multiple bugs (invisible buttons, invisible KR items).

### Correct Pattern
```javascript
// Page load animations
gsap.fromTo('#element',
  { y: 40, opacity: 0 },
  { y: 0, opacity: 1, duration: 0.7, clearProps: 'opacity,transform' }
);

// Staggered list items
gsap.fromTo('.items',
  { x: -15, opacity: 0 },
  { x: 0, opacity: 1, stagger: 0.05, duration: 0.3, clearProps: 'opacity,transform' }
);
```

### Safety Net CSS
Always add a CSS fallback for critical elements:
```css
.my-important-button { opacity: 1 !important; }
.goal-card.expanded .kr-item { opacity: 1 !important; }
```

---

## 5. Troubleshooting Guide

### "undefined" text appearing in rendered content
**Cause:** Stale localStorage with corrupted data from a previous version.
**Fix:**
1. Bump `DATA_VERSION` in both `goals.html` and `goal.html`
2. Bump `version` in `goals-data.json`
3. The load function force-clears localStorage on every page load

### Elements invisible after page load
**Cause:** `gsap.from()` setting `opacity: 0` and animation not completing.
**Fix:**
1. Replace `gsap.from()` with `gsap.fromTo()` and add `clearProps: 'opacity,transform'`
2. Add CSS safety net: `element { opacity: 1 !important; }`

### Button or element not showing
**Cause:** GSAP animation or z-index issue.
**Fix:**
1. Check if element is animated — convert to `fromTo`
2. Add `position: relative; z-index: 2;` to parent container
3. Add `opacity: 1 !important` CSS rule

### Supabase query returns empty
**Check:**
1. Table name is correct (e.g., `'contacts'` not `'contact'`)
2. Filter syntax uses PostgREST format: `column=eq.value`, `column.ilike.*query*`
3. `or` filter wraps conditions: `or=(col1.eq.val,col2.eq.val)`

### Vercel deploy fails
**Check:**
1. No syntax errors in HTML/JS (Vercel serves static files, but API functions must compile)
2. `vercel.json` is valid JSON
3. API functions use proper exports: `module.exports = async (req, res) => {}`

### CSP (Content Security Policy) blocks resource
**Fix:** Update the CSP meta tag in the page's `<head>`:
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com;
  font-src https://fonts.gstatic.com https://cdn.fontshare.com;
  connect-src 'self' https://gxunrnyehltpbgdodkkm.supabase.co;
  img-src 'self' data: blob: https:;
">
```

### localStorage full or conflicting
**Fix:** The app uses key `vsdr-goals-data`. If issues persist, clear all VSDR keys:
```javascript
localStorage.removeItem('vsdr-goals-data');
localStorage.removeItem('vsdr-theme');
localStorage.removeItem('vsdr-auth-session');
```

---

## 6. Change Request Tracking

When the user requests a change, follow this structured process:

### Step 1: Log the Request
Record in commit messages what was requested and why:
```
Add [feature] — requested by [user]

- What: [description of the change]
- Why: [business reason or user need]
- Files changed: [list]
```

### Step 2: Assess Impact
| Question | Action |
|---|---|
| Does it change goals-data.json? | Bump `version` field |
| Does it add a new page? | Update sidebar.js nav items |
| Does it change Supabase schema? | Document the migration |
| Does it affect mobile? | Test at 768px breakpoint |
| Does it use GSAP? | Use `fromTo` + `clearProps` only |

### Step 3: Implement & Test
1. Make the code changes
2. Verify no console errors
3. Check light/dark theme compatibility (use CSS variables)
4. Check mobile responsiveness (768px breakpoint)

### Step 4: Deploy
```bash
git add <files>
git commit -m "Description

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin <branch>
gh pr create --title "Title" --body "## Summary\n..."
gh pr merge <number> --merge
```

### Step 5: Verify Production
- Vercel deploys in ~1-2 minutes after merge to `main`
- Hard-refresh `vsdr.vercel.app` to bypass browser cache
- Clear localStorage if data changes were made

---

## 7. Git Configuration

```bash
# Required for this repo (set if not configured)
git config user.name "Baza"
git config user.email "afabaza@gmail.com"
```

### Commit Message Format
```
<verb> <what changed> — <brief context>

- Bullet point details
- Another detail

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

Verbs: Add, Fix, Update, Remove, Refactor, Bump

---

## 8. Monitoring & Health

### Check if site is up
```bash
curl -s -o /dev/null -w "%{http_code}" https://vsdr.vercel.app
# Should return 200
```

### Check recent deployments
```bash
gh api repos/gaby-sprintly/sprintly-vsdr/deployments --jq '.[0:5] | .[] | {created_at, environment, state: .statuses_url}'
```

### Check recent commits
```bash
git log --oneline -10
```

### Check open PRs
```bash
gh pr list
```

---

## 9. Security Checklist

- Never expose Supabase service key (only publishable key in frontend)
- CSP headers are set in each page's `<meta>` tag AND in `vercel.json`
- Vercel security headers: X-Frame-Options DENY, X-Content-Type-Options nosniff
- Auth guard: `requireAuth()` checks session before page load
- No inline eval or document.write
- All user input escaped via `esc()` function before rendering

---

## 10. Quick Reference — File Responsibilities

| If you need to... | Edit this file |
|---|---|
| Change navigation items | `js/sidebar.js` |
| Change shared styles | `css/design-system.css` |
| Change auth flow | `js/auth.js` |
| Change Supabase queries | `js/supabase-client.js` |
| Add/edit goals data | `goals-data.json` + bump version |
| Add/edit project data | `projects-data.json` |
| Change deployment config | `vercel.json` |
| Add a serverless API | `api/<name>.js` |
| Change a specific page | `<pagename>.html` (self-contained CSS+JS) |
