---
name: vsdr-operations
description: "Operations skill for using VSDR (Safira). Use this skill when Gaby or any agent needs to add, update, or manage goals, projects, key results, next actions, recommended actions, follow-ups, team members, stakeholders, contacts, proposals, or any operational data inside the VSDR platform. Trigger when: 'add a goal', 'update KR', 'new follow-up', 'add team member', 'create project', 'update pipeline', 'add contact', 'manage stakeholders', 'update notes', 'check goals progress', or any data CRUD operation on the VSDR."
---

# VSDR (Safira) Operations Guide

You are Gaby, the AI operations agent for Sprintly Partners. This skill teaches you how to operate the VSDR platform — how to read, create, update, and delete data across all pages.

## Architecture Overview

VSDR is a **vanilla JavaScript multi-page app** hosted on **Vercel** at `vsdr.vercel.app`. There is no framework (no React/Vue/Angular). Data lives in two places:

| Data Source | What It Stores | How to Access |
|---|---|---|
| **Supabase** (PostgreSQL) | Contacts, proposals, matches | `sbGet()`, `sbInsert()`, `sbUpdate()`, `sbDelete()` in `js/supabase-client.js` |
| **goals-data.json** + localStorage | Goals, KRs, actions, follow-ups | Fetch JSON, read/write `localStorage('vsdr-goals-data')` |
| **projects-data.json** | Pipeline projects | Fetch JSON (read-only from frontend) |

### Supabase Connection
```
URL: https://gxunrnyehltpbgdodkkm.supabase.co
Key: sb_publishable_fipkXCnAvAV-om1bXwAfYA_4b3KRu0v (client-side only)
```

### API Functions (js/supabase-client.js)
```javascript
sbGet(table, query)              // SELECT — e.g. sbGet('contacts', 'select=*&vip=eq.true')
sbInsert(table, data, options)   // INSERT — e.g. sbInsert('contacts', { first_name: 'Kate' })
sbUpdate(table, match, data)     // PATCH  — e.g. sbUpdate('contacts', 'id=eq.123', { vip: true })
sbDelete(table, match)           // DELETE — e.g. sbDelete('contacts', 'id=eq.123')
sbCount(table, filter)           // COUNT  — e.g. sbCount('contacts', 'vip=eq.true')
```

---

## Page-by-Page Operations

### 1. Goals & OKRs (`goals.html`)

**Data source:** `goals-data.json` cached in `localStorage('vsdr-goals-data')` with `version: 4`.

**Data model:**
```json
{
  "version": 4,
  "goals": [{
    "id": "slug-id",
    "title": "Goal Title",
    "description": "Context...",
    "status": "on-track|at-risk|behind|not-started",
    "lastUpdated": "Apr 14, 2026",
    "projectManager": { "name": "Name", "role": "Role" },
    "keyResults": [{ "text": "KR text", "done": false }],
    "nextActions": ["Action 1", "Action 2"],
    "recommendedActions": ["Rec 1"],
    "teamMembers": [{ "name": "Name", "role": "Role" }],
    "stakeholders": [{ "name": "Org", "role": "Role" }],
    "followUps": [{ "text": "Waiting for...", "owner": "Name", "contactId": 123 }],
    "notes": "Free text notes"
  }],
  "quarterlyGoals": [{
    "id": "slug",
    "title": "Q goal",
    "status": "at-risk",
    "parentGoalId": "annual-goal-id"
  }]
}
```

**How to add a new goal:**
1. Edit `goals-data.json` — add a new object to the `goals` array
2. Include all fields: id, title, description, status, projectManager, keyResults, nextActions, recommendedActions, teamMembers, stakeholders, followUps, notes
3. Bump the `version` number so localStorage refreshes
4. Commit and deploy

**How to update a goal via the UI:**
- The user clicks the goal card → expands → uses inline "+ Add" buttons for each section
- Checkboxes toggle KR completion → auto-updates progress ring
- All changes persist to localStorage

**How to update a goal via code:**
- Edit `goals-data.json` directly
- Always bump `version` when changing seed data

**Progress calculation:** `progress = Math.round((doneKRs / totalKRs) * 100)`

**Stats bar:** Auto-calculated from goals array — total, on-track count, at-risk count, behind count, avg progress.

---

### 2. Goal Detail Page (`goal.html?id=<goal-id>`)

Shows full detail for a single goal. Same data source as goals.html.

**Features available:**
- Toggle KR checkboxes (progress updates live)
- Inline edit any item (pencil icon on hover)
- Inline delete any item (x icon on hover)
- Change/Remove Project Manager
- Edit follow-up owner (with Supabase contact autocomplete)
- Add/edit notes

---

### 3. Pipeline / Projects (`pipeline.html` → `project.html?id=<project-id>`)

**Data source:** `projects-data.json`

**Data model per project:**
```json
{
  "id": "slug-id",
  "name": "Project Name",
  "status": "Launching|Signed|Active|In Review|Research|At Risk",
  "company_brief": "Description...",
  "key_metrics": "23 applications received",
  "spoc": { "name": "Name", "role": "Role", "email": "email" },
  "executives": [{ "name": "Name", "role": "Role", "company": "Org" }],
  "timeline": [{ "date": "Apr 2026", "milestone": "Event", "status": "completed|in_progress|upcoming|at_risk" }],
  "next_actions": ["Action 1"],
  "possible_intros": ["Name (Context)"],
  "notes": "Free text"
}
```

**How to add a project:** Add a new object to the `projects` array in `projects-data.json`.

---

### 4. Contacts / Network (`network.html` → `contact.html?id=<uuid>`)

**Data source:** Supabase `contacts` table

**Contact schema:**
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| first_name | text | First name |
| last_name | text | Last name |
| email | text | Email address |
| company | text | Company name |
| title | text | Job title |
| linkedin | text | LinkedIn URL |
| phone | text | Phone |
| contact_type | text | founder, investor, corporate, advisor |
| vip | boolean | VIP flag |
| tags | text | Tags |
| industry | text | Industry |
| region | text | Geographic region |
| enrichment_status | text | enriched or pending |
| gaby_notes | text | AI research notes |
| notes | text | User notes |
| follow_up_date | date | Next follow-up |
| follow_up_reason | text | Reason for follow-up |
| needs_follow_up | boolean | Follow-up flag |
| last_contacted | timestamp | Last contact date |
| created_at | timestamp | Record creation |
| introduced_by | text | Who introduced this contact |

**How to add a contact:**
```javascript
await sbInsert('contacts', {
  first_name: 'Kate',
  last_name: 'Smith',
  company: 'CloudCom',
  contact_type: 'corporate',
  notes: 'Met at SF dinner'
}, { returnData: true });
```

**How to search contacts:**
```javascript
// By name
await sbGet('contacts', 'select=*&or=(first_name.ilike.*kate*,last_name.ilike.*kate*)&limit=10');
// VIPs only
await sbGet('contacts', 'select=*&vip=eq.true&order=last_name.asc');
// By type
await sbGet('contacts', 'select=*&contact_type=eq.founder');
```

**How to update a contact:**
```javascript
await sbUpdate('contacts', 'id=eq.<uuid>', { vip: true, follow_up_date: '2026-04-20' });
```

---

### 5. Other Pages

| Page | Purpose | Data Source |
|---|---|---|
| `proposals.html` / `proposal.html` | Proposal management | Supabase + JS renderers |
| `outreach.html` | Outreach tracking | Supabase contacts |
| `analytics.html` | Contact analytics | Supabase contacts |
| `reports.html` | Database health reports | Supabase contacts |
| `ingestion.html` | Contact import (CSV/manual) | Supabase contacts |
| `matches.html` | Introduction matching | Network data |
| `interactions.html` | Contact interaction history | Supabase |
| `bmc.html` | Business Model Canvas | Static |
| `settings.html` | App settings | Supabase + localStorage |

---

## Common Operations Checklist

### Adding data to a goal:
1. Open `goals-data.json`
2. Find the goal by `id`
3. Add items to the relevant array (keyResults, nextActions, etc.)
4. Bump `version` number
5. Commit → push → merge to `main` → Vercel auto-deploys

### Adding a new contact to Supabase:
1. Use `sbInsert('contacts', { first_name, last_name, company, ... })`
2. Or use the Ingestion page (`ingestion.html`) for bulk import

### Updating follow-up owners:
- Follow-ups link to Supabase contacts via `contactId`
- When adding a follow-up with a new name, the system auto-creates a Supabase contact
- Existing contacts are searchable via autocomplete (2+ chars triggers search)

---

## Design System Reference

| Token | Value | Use |
|---|---|---|
| `--green` | #4ECB71 | On track, success, primary buttons |
| `--amber` | #F59E0B | At risk, warnings, follow-up owners |
| `--coral` | #EF4444 | Behind, errors, delete actions |
| `--teal` | #2DD4BF | Next actions, links, secondary |
| `--purple` | #A78BFA | Recommended actions, stakeholders |
| `--n50` | #F8FAFC | Primary text (dark theme) |
| `--n400` | #94A3B8 | Secondary text |
| `--n800` | #1E293B | Card backgrounds |
| `--display` | Space Grotesk | Headings |
| `--body` | General Sans | Body text |

## Status Types
- `on-track` → green
- `at-risk` → amber
- `behind` → coral
- `not-started` → gray
- `in-progress` → teal
- `upcoming` → gray
