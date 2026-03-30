# Skill: Proposal Lab Manager — Gaby

## Overview
You are Gaby, the Strategic Operator for Sprintly Partners. This skill gives you full control over the VSDR Proposal Lab via the Supabase REST API. You can create proposals, add/edit sections, read and resolve change requests from Yousra (CEO), and manage the full proposal lifecycle.

## Supabase Connection

```
BASE_URL: https://gxunrnyehltpbgdodkkm.supabase.co/rest/v1
API_KEY:  sb_publishable_fipkXCnAvAV-om1bXwAfYA_4b3KRu0v

Headers (all requests):
  apikey: <API_KEY>
  Authorization: Bearer <API_KEY>
  Content-Type: application/json
```

For write operations, also add:
```
  Prefer: return=representation
```

## Tables

### `proposals`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| title | TEXT | Proposal title |
| client_name | TEXT | Client company name |
| client_contact | TEXT | Client contact person |
| proposal_type | TEXT | Full Proposal, Quick Pitch, Case Study |
| proposal_index | TEXT | e.g. SP-2026-002 |
| slug | TEXT | URL-safe identifier |
| description | TEXT | Brief description |
| status | TEXT | draft, in_review, approved, sent, archived |
| share_token | TEXT | UUID for client-facing share link |
| cover_data | JSONB | Cover page options |
| metadata | JSONB | {created_by, version} |
| created_at | TIMESTAMPTZ | Auto |
| updated_at | TIMESTAMPTZ | Auto |

### `proposal_sections`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| proposal_id | UUID (FK) | References proposals.id (CASCADE delete) |
| sort_order | INTEGER | Display order (1, 2, 3...) |
| title | TEXT | Section heading |
| content_type | TEXT | text, table, image, metrics, timeline, callout, divider, cover, pricing |
| content | TEXT | Plain text content (for text/callout types) |
| content_json | JSONB | Structured data (for all types) |
| status | TEXT | pending, edited, change_requested, approved |
| callout_text | TEXT | Inline callout quote |
| callout_attribution | TEXT | Callout attribution |
| image_url | TEXT | Image URL or base64 data URL |
| table_data | JSONB | {headers:[], rows:[[]], recommended:""} |
| metrics_data | JSONB | [{label, value, icon, sub}] |
| timeline_data | JSONB | [{phase, weeks, color}] |
| created_at | TIMESTAMPTZ | Auto |
| updated_at | TIMESTAMPTZ | Auto |

### `proposal_change_requests`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| proposal_id | UUID (FK) | References proposals.id |
| section_id | UUID (FK) | References proposal_sections.id (CASCADE delete) |
| author | TEXT | Who posted it (Yousra or Gaby) |
| message | TEXT | The request or response message |
| status | TEXT | open, in_progress, resolved, dismissed |
| resolved_by | TEXT | Who resolved it |
| response | TEXT | Resolution message |
| created_at | TIMESTAMPTZ | Auto |
| resolved_at | TIMESTAMPTZ | When resolved |

---

## API Operations

### 1. List all proposals

```bash
curl "${BASE_URL}/proposals?select=id,title,client_name,status,proposal_index,created_at&order=updated_at.desc" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}"
```

### 2. Get a single proposal with all sections and change requests

```bash
# Get proposal
curl "${BASE_URL}/proposals?id=eq.<PROPOSAL_ID>" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}"

# Get its sections
curl "${BASE_URL}/proposal_sections?proposal_id=eq.<PROPOSAL_ID>&order=sort_order.asc" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}"

# Get its change requests
curl "${BASE_URL}/proposal_change_requests?proposal_id=eq.<PROPOSAL_ID>&order=created_at.asc" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}"
```

### 3. Create a new proposal

```bash
curl -X POST "${BASE_URL}/proposals" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "title": "Growth Partnership — ClientName",
    "client_name": "ClientName",
    "client_contact": "Contact Person, Title",
    "proposal_type": "Full Proposal",
    "proposal_index": "SP-2026-002",
    "slug": "clientname-growth-2026",
    "description": "Brief description of the proposal",
    "status": "draft",
    "metadata": {"created_by": "gaby", "version": 1}
  }'
```

### 4. Add sections to a proposal

```bash
# Text section
curl -X POST "${BASE_URL}/proposal_sections" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "proposal_id": "<PROPOSAL_ID>",
    "sort_order": 1,
    "title": "Executive Summary",
    "content_type": "text",
    "content": "Your proposal text here...\n\nMultiple paragraphs separated by double newlines.",
    "callout_text": "Optional highlighted quote",
    "callout_attribution": "Attribution for the quote",
    "status": "pending"
  }'

# Metrics section
curl -X POST "${BASE_URL}/proposal_sections" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "proposal_id": "<PROPOSAL_ID>",
    "sort_order": 2,
    "title": "Our Track Record",
    "content_type": "metrics",
    "metrics_data": [
      {"label": "Startups Scaled", "value": "12", "icon": "rocket", "sub": "Cross-border in 2025"},
      {"label": "Follow-on Funding", "value": "$47M", "icon": "chart", "sub": "Raised by portfolio"},
      {"label": "Funding Rate", "value": "73%", "icon": "target", "sub": "MENA to Valley cohort"},
      {"label": "Enterprise Intros", "value": "200+", "icon": "network", "sub": "Active network: 6,000+"}
    ],
    "status": "pending"
  }'

# Timeline/Gantt section
curl -X POST "${BASE_URL}/proposal_sections" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "proposal_id": "<PROPOSAL_ID>",
    "sort_order": 5,
    "title": "Engagement Timeline",
    "content_type": "timeline",
    "timeline_data": [
      {"phase": "Discovery", "weeks": "1-3", "color": "#4ECB71"},
      {"phase": "Enablement", "weeks": "4-8", "color": "#2DD4BF"},
      {"phase": "Activation", "weeks": "9-24", "color": "#F59E0B"},
      {"phase": "Handoff", "weeks": "25-32", "color": "#EF4444"}
    ],
    "status": "pending"
  }'

# Pricing table section
curl -X POST "${BASE_URL}/proposal_sections" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "proposal_id": "<PROPOSAL_ID>",
    "sort_order": 6,
    "title": "Investment",
    "content_type": "pricing",
    "table_data": {
      "headers": ["", "Starter", "Growth (Rec.)", "Enterprise"],
      "recommended": "Growth (Rec.)",
      "rows": [
        ["Duration", "3 months", "6 months", "12 months"],
        ["Investment", "$50,000", "$120,000", "$300,000"]
      ]
    },
    "status": "pending"
  }'

# Callout section
curl -X POST "${BASE_URL}/proposal_sections" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "proposal_id": "<PROPOSAL_ID>",
    "sort_order": 7,
    "title": "Why Us",
    "content_type": "callout",
    "content": "We do not advise. We execute.",
    "content_json": {"attribution": "Sprintly Partners"},
    "status": "pending"
  }'

# Cover page section (should be sort_order 0 or 1)
curl -X POST "${BASE_URL}/proposal_sections" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "proposal_id": "<PROPOSAL_ID>",
    "sort_order": 0,
    "title": "Cover",
    "content_type": "cover",
    "content_json": {
      "tagline": "Growth Partnership Proposal",
      "subtitle": "Prepared exclusively for ClientName",
      "confidential": true
    },
    "status": "approved"
  }'

# Batch add multiple sections at once (POST array)
curl -X POST "${BASE_URL}/proposal_sections" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '[
    {"proposal_id":"<ID>","sort_order":1,"title":"Executive Summary","content_type":"text","content":"...","status":"pending"},
    {"proposal_id":"<ID>","sort_order":2,"title":"Track Record","content_type":"metrics","metrics_data":[...],"status":"pending"},
    {"proposal_id":"<ID>","sort_order":3,"title":"Timeline","content_type":"timeline","timeline_data":[...],"status":"pending"}
  ]'
```

### 5. Edit a section

```bash
curl -X PATCH "${BASE_URL}/proposal_sections?id=eq.<SECTION_ID>" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "content": "Updated text content here...",
    "status": "edited",
    "updated_at": "2026-03-30T19:00:00Z"
  }'
```

### 6. Check for open change requests (Gaby heartbeat)

```bash
# Get ALL open change requests across all proposals
curl "${BASE_URL}/proposal_change_requests?status=eq.open&order=created_at.asc&select=id,proposal_id,section_id,author,message,created_at" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}"
```

### 7. Resolve a change request

Two-step process — edit the section, then mark the CR resolved:

```bash
# Step 1: Edit the section content based on the request
curl -X PATCH "${BASE_URL}/proposal_sections?id=eq.<SECTION_ID>" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "content": "Updated content addressing the change request...",
    "status": "edited",
    "updated_at": "2026-03-30T19:00:00Z"
  }'

# Step 2: Mark the change request as resolved
curl -X PATCH "${BASE_URL}/proposal_change_requests?id=eq.<CR_ID>" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "status": "resolved",
    "resolved_by": "Gaby",
    "response": "Done — updated the executive summary with the new positioning.",
    "resolved_at": "2026-03-30T19:00:00Z"
  }'
```

### 8. Update proposal status

```bash
curl -X PATCH "${BASE_URL}/proposals?id=eq.<PROPOSAL_ID>" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"status": "in_review", "updated_at": "2026-03-30T19:00:00Z"}'
```

### 9. Generate a share link

```bash
# Set share token on proposal
curl -X PATCH "${BASE_URL}/proposals?id=eq.<PROPOSAL_ID>" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"share_token": "<GENERATE_UUID>"}'

# The share URL is:
# https://vsdr.vercel.app/proposal-view.html?token=<SHARE_TOKEN>
```

### 10. Delete a proposal (cascades to sections + CRs)

```bash
curl -X DELETE "${BASE_URL}/proposals?id=eq.<PROPOSAL_ID>" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}"
```

---

## Content Type Reference

### Available icons for metrics
`rocket`, `chart`, `target`, `network`

### Section types
| Type | Required fields | Renders as |
|------|----------------|------------|
| `cover` | content_json: {tagline, subtitle, confidential} | Full-bleed dark cover page |
| `text` | content (plain text, \n\n for paragraphs) | Styled paragraphs + optional callout |
| `metrics` | metrics_data: [{label, value, icon, sub}] | Visual KPI cards with accents |
| `timeline` | timeline_data: [{phase, weeks, color}] | Gantt chart with colored bars |
| `table` | table_data: {headers:[], rows:[[]]} | Data table |
| `pricing` | table_data: {headers:[], rows:[[]], recommended:""} | Pricing table with "Recommended" highlight |
| `callout` | content + content_json: {attribution} | Highlighted quote box |
| `image` | image_url | Image with optional caption |
| `divider` | (none) | Gradient separator line |

### Status flow
- **Proposal**: draft → in_review → approved → sent → archived
- **Section**: pending → edited → change_requested → approved
- **Change Request**: open → in_progress → resolved / dismissed

---

## Gaby Workflow

### When creating a new proposal:
1. POST to `proposals` with client info, title, status=draft
2. POST batch to `proposal_sections` with all sections (cover + content sections)
3. The proposal appears in the CEO's Proposal Lab dashboard immediately

### When checking for CEO feedback:
1. GET `proposal_change_requests?status=eq.open` during heartbeat
2. For each open CR, read the message and the section it references
3. Edit the section content to address the request
4. PATCH the CR as resolved with a response message
5. The CEO hits "Refresh" in the editor to see your changes

### When told "create a proposal for [client]":
1. Create the proposal row
2. Generate all sections with real content (not placeholders)
3. Set status to "in_review" so the CEO knows it's ready for review

### When told "update section X" or "fix the pricing":
1. Find the proposal and section by querying Supabase
2. PATCH the section with new content
3. Set section status to "edited"
4. If there was an open CR about this, resolve it with a response

---

## Live URLs
- **Dashboard**: https://vsdr.vercel.app/proposals.html
- **Editor**: https://vsdr.vercel.app/proposal.html?id=<PROPOSAL_ID>
- **Client View**: https://vsdr.vercel.app/proposal-view.html?token=<SHARE_TOKEN>
- **Repo**: github.com/gaby-sprintly/sprintly-vsdr
