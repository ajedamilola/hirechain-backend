# Quick Start Guide - New Features

## Installation

The new features are already integrated. Just ensure your dependencies are up to date:

```bash
npm install
```

## What's New?

### 1. ✅ Gig Applications
- Freelancers can apply to public gigs
- Clients review and accept/reject applications

### 2. ✅ Private Gigs & Invitations
- Create invite-only gigs
- Send invitations to specific freelancers

### 3. ✅ Ratings & Reviews
- 5-star rating system
- Both parties can review after completion
- Review statistics on profiles

### 4. ✅ Freelancer Search & Browse
- Search and filter freelancers by skills
- View detailed profiles with stats
- Sort by rating, XP, or recent
- Top-rated freelancers leaderboard

## Quick Test

### Test Applications (Public Gig)

```bash
# 1. Create a public gig
curl -X POST http://localhost:3000/gigs/prepare-creation \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "0.0.12345",
    "title": "Build a DApp",
    "description": "Need a Solidity developer",
    "budget": 100,
    "visibility": "PUBLIC"
  }'

# 2. Freelancer applies
curl -X POST http://localhost:3000/applications/apply \
  -H "Content-Type: application/json" \
  -d '{
    "gigRefId": "your-gig-id",
    "freelancerId": "0.0.67890",
    "coverLetter": "I have 5 years of Solidity experience..."
  }'

# 3. Client views applications
curl "http://localhost:3000/applications/gig/your-gig-id?clientId=0.0.12345"

# 4. Client accepts application
curl -X POST http://localhost:3000/applications/application-id/accept \
  -H "Content-Type: application/json" \
  -d '{"clientId": "0.0.12345"}'
```

### Test Private Gigs

```bash
# 1. Create a private gig
curl -X POST http://localhost:3000/gigs/prepare-creation \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "0.0.12345",
    "title": "Private Project",
    "description": "Confidential work",
    "budget": 200,
    "visibility": "PRIVATE"
  }'

# 2. Send invitation
curl -X POST http://localhost:3000/invitations/send \
  -H "Content-Type: application/json" \
  -d '{
    "gigRefId": "your-gig-id",
    "freelancerId": "0.0.67890",
    "clientId": "0.0.12345",
    "message": "I think you would be perfect for this!"
  }'

# 3. Freelancer views invitations
curl "http://localhost:3000/invitations/freelancer/0.0.67890"

# 4. Freelancer accepts
curl -X POST http://localhost:3000/invitations/invitation-id/accept \
  -H "Content-Type: application/json" \
  -d '{"freelancerId": "0.0.67890"}'
```

### Test Reviews

```bash
# After gig completion, submit review
curl -X POST http://localhost:3000/reviews/submit \
  -H "Content-Type: application/json" \
  -d '{
    "gigRefId": "completed-gig-id",
    "reviewerId": "0.0.12345",
    "rating": 5,
    "comment": "Excellent work, highly recommended!"
  }'

# Get user's review stats
curl "http://localhost:3000/reviews/user/0.0.67890/stats"
```

### Test Freelancer Search

```bash
# Browse all freelancers
curl "http://localhost:3000/freelancers/browse"

# Search by skills
curl "http://localhost:3000/freelancers/browse?skills=Solidity,React&minRating=4"

# Search by name
curl "http://localhost:3000/freelancers/browse?search=John"

# Get detailed profile
curl "http://localhost:3000/freelancers/0.0.67890"

# Get all skills
curl "http://localhost:3000/freelancers/skills/list"

# Get top-rated freelancers
curl "http://localhost:3000/freelancers/top/rated?limit=5"
```

## File Structure

```
hirechain-backend/
├── db/
│   ├── connection.js
│   └── models.js              # ✨ Updated with new schemas
├── routes/
│   ├── applications.js        # ✨ NEW
│   ├── invitations.js         # ✨ NEW
│   ├── reviews.js             # ✨ NEW
│   └── freelancers.js         # ✨ NEW
├── email_system/
│   └── templates/
│       ├── application_notification.ejs    # ✨ NEW
│       ├── application_accepted.ejs        # ✨ NEW
│       ├── invitation_notification.ejs     # ✨ NEW
│       └── invitation_accepted.ejs         # ✨ NEW
├── index.js                   # ✨ Updated
├── NEW_FEATURES.md           # ✨ Complete documentation
└── QUICK_START.md            # ✨ This file
```

## Key Changes to Existing Code

### 1. Gig Model
- Added `visibility` field: `'PUBLIC'` or `'PRIVATE'`
- Defaults to `'PUBLIC'` for backward compatibility

### 2. GET /gigs
- Now only returns PUBLIC gigs
- Private gigs are hidden from marketplace

### 3. Gig Creation
- Accepts optional `visibility` parameter
- Stored in HCS for immutability

## No Breaking Changes! ✅

All existing functionality works exactly as before. New features are additive.

## Common Workflows

### Public Gig Flow
```
Client creates PUBLIC gig
    ↓
Freelancers see in marketplace
    ↓
Freelancers apply with cover letter
    ↓
Client reviews applications
    ↓
Client accepts one (others auto-rejected)
    ↓
Client assigns gig (existing flow)
    ↓
Work completed, escrow released
    ↓
Both parties leave reviews
```

### Private Gig Flow
```
Client creates PRIVATE gig
    ↓
Client invites specific freelancers
    ↓
Freelancers receive invitations
    ↓
Freelancer accepts invitation
    ↓
Client assigns gig (existing flow)
    ↓
Work completed, escrow released
    ↓
Both parties leave reviews
```

## Environment Variables

No new environment variables needed! Uses existing MongoDB connection.

## Testing Checklist

- [ ] Create public gig
- [ ] Create private gig
- [ ] Apply to public gig
- [ ] Cannot apply to private gig
- [ ] Send invitation to private gig
- [ ] Accept invitation
- [ ] Accept application
- [ ] Complete gig and submit reviews
- [ ] View review statistics

## Troubleshooting

### Applications not working?
- Ensure gig is PUBLIC
- Ensure gig status is OPEN
- Check for duplicate applications

### Invitations not working?
- Ensure gig is PRIVATE
- Ensure freelancer profile exists
- Check for duplicate invitations

### Reviews not working?
- Ensure gig is COMPLETED
- Ensure reviewer is a participant
- Check for duplicate reviews

## Next Steps

1. **Test the endpoints** using the examples above
2. **Integrate with your frontend** using the API documentation
3. **Customize email templates** in `email_system/templates/`
4. **Add more features** from the suggestions in NEW_FEATURES.md

## Support

For detailed API documentation, see **NEW_FEATURES.md**

For freelancer search documentation, see **FREELANCER_SEARCH.md**

For MongoDB setup, see **MONGODB_MIGRATION.md**
