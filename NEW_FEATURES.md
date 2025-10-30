# HireChain New Features Documentation

This document describes the newly added features to the HireChain platform.

## Table of Contents
1. [Gig Applications System](#gig-applications-system)
2. [Private Gigs & Invitations](#private-gigs--invitations)
3. [Ratings & Reviews System](#ratings--reviews-system)
4. [Freelancer Search & Browse](#freelancer-search--browse)
5. [API Endpoints](#api-endpoints)

---

## Gig Applications System

### Overview
Freelancers can now apply to **public gigs** with a cover letter and proposed rate. Clients can review applications and accept/reject them.

### Workflow

```
1. Freelancer sees public gig → Submits application with cover letter
2. Client receives notification → Reviews all applications
3. Client accepts one application → Other applications auto-rejected
4. Client proceeds with gig assignment (existing flow)
```

### Database Schema

```javascript
Application {
  gigRefId: String,
  freelancerId: String,
  coverLetter: String,
  proposedRate: String (optional),
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED',
  appliedAt: Date
}
```

### Key Features
- ✅ Prevent duplicate applications (unique index on gigRefId + freelancerId)
- ✅ Only for PUBLIC gigs
- ✅ Email notifications to client on new application
- ✅ Email notification to freelancer on acceptance
- ✅ Auto-reject other applications when one is accepted

---

## Private Gigs & Invitations

### Overview
Clients can now create **private gigs** that are invite-only. These gigs don't appear in the public marketplace.

### Gig Visibility Types

| Type | Description | Who Can See | How to Join |
|------|-------------|-------------|-------------|
| **PUBLIC** | Default, visible to all | Everyone | Apply directly |
| **PRIVATE** | Invite-only | Only invited freelancers | Must be invited |

### Workflow

```
1. Client creates PRIVATE gig → Not visible in marketplace
2. Client invites specific freelancers → Sends invitation with message
3. Freelancer receives notification → Accepts or rejects invitation
4. If accepted → Client can proceed with assignment
```

### Database Schema

```javascript
Invitation {
  gigRefId: String,
  freelancerId: String,
  message: String (optional),
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED',
  invitedAt: Date
}
```

### Key Features
- ✅ Private gigs hidden from public marketplace
- ✅ Clients can invite multiple freelancers
- ✅ Prevent duplicate invitations
- ✅ Email notifications to freelancers
- ✅ Freelancers can accept/reject invitations

---

## Ratings & Reviews System

### Overview
After gig completion, both parties can rate and review each other (1-5 stars + optional comment).

### Review Types

1. **CLIENT_TO_FREELANCER**: Client reviews freelancer's work
2. **FREELANCER_TO_CLIENT**: Freelancer reviews client's professionalism

### Workflow

```
1. Gig is completed (status = COMPLETED or COMPLETED_BY_ARBITER)
2. Both parties can submit reviews
3. Reviews are public and displayed on user profiles
4. Each party can only review once per gig
```

### Database Schema

```javascript
Review {
  gigRefId: String,
  reviewerId: String,
  revieweeId: String,
  rating: Number (1-5),
  comment: String (optional),
  reviewType: 'CLIENT_TO_FREELANCER' | 'FREELANCER_TO_CLIENT'
}
```

### Review Statistics

User profiles now include:
- **Average rating** (overall)
- **Total reviews**
- **Rating distribution** (how many 1-star, 2-star, etc.)
- **Separate stats** for "as freelancer" and "as client"

---

## Freelancer Search & Browse

### Overview
Clients can now browse, search, and filter freelancers to find the perfect match for their projects. This is especially useful for private gigs where clients want to invite specific freelancers.

### Key Features
- ✅ Browse all freelancers with pagination
- ✅ Search by name or skills
- ✅ Filter by specific skills (comma-separated)
- ✅ Filter by minimum rating and XP
- ✅ Sort by rating, XP, or recent
- ✅ View detailed profiles with stats
- ✅ Get list of all skills (for autocomplete)
- ✅ Top-rated freelancers leaderboard

### Freelancer Profile Stats

Each freelancer profile includes:
- **Average rating** (from client reviews)
- **Total reviews count**
- **Rating distribution**
- **XP points**
- **Completed gigs count**
- **Recent reviews with context**
- **Portfolio of completed work**

### Use Cases

1. **Browse for Private Gig**: Search for Solidity developers with 4+ rating to invite
2. **Review Before Accepting**: View applicant's full profile before accepting application
3. **Discover Top Talent**: Showcase top-rated freelancers on homepage
4. **Skill-Based Search**: Find freelancers with specific skill combinations

**See [FREELANCER_SEARCH.md](FREELANCER_SEARCH.md) for complete documentation.**

---

## API Endpoints

### Applications

#### 1. Submit Application
```http
POST /applications/apply
Content-Type: application/json

{
  "gigRefId": "uuid",
  "freelancerId": "0.0.xxxxx",
  "coverLetter": "I am perfect for this job because...",
  "proposedRate": "50 HBAR" // optional
}
```

**Response:**
```json
{
  "message": "Application submitted successfully.",
  "application": { ... }
}
```

#### 2. Get Applications for a Gig (Client Only)
```http
GET /applications/gig/:gigRefId?clientId=0.0.xxxxx
```

**Response:**
```json
[
  {
    "_id": "...",
    "gigRefId": "...",
    "freelancerId": "0.0.xxxxx",
    "coverLetter": "...",
    "status": "PENDING",
    "freelancerProfile": {
      "name": "John Doe",
      "skills": ["Solidity", "React"],
      ...
    }
  }
]
```

#### 3. Get Freelancer's Applications
```http
GET /applications/freelancer/:freelancerId
```

#### 4. Accept Application
```http
POST /applications/:applicationId/accept
Content-Type: application/json

{
  "clientId": "0.0.xxxxx"
}
```

#### 5. Reject Application
```http
POST /applications/:applicationId/reject
Content-Type: application/json

{
  "clientId": "0.0.xxxxx"
}
```

---

### Invitations

#### 1. Send Invitation (Private Gigs)
```http
POST /invitations/send
Content-Type: application/json

{
  "gigRefId": "uuid",
  "freelancerId": "0.0.xxxxx",
  "clientId": "0.0.xxxxx",
  "message": "I think you'd be perfect for this project..." // optional
}
```

#### 2. Get Invitations for a Gig (Client Only)
```http
GET /invitations/gig/:gigRefId?clientId=0.0.xxxxx
```

#### 3. Get Freelancer's Invitations
```http
GET /invitations/freelancer/:freelancerId
```

**Response:**
```json
[
  {
    "_id": "...",
    "gigRefId": "...",
    "status": "PENDING",
    "message": "...",
    "gig": {
      "title": "Build a DApp",
      "budget": "100 HBAR",
      ...
    },
    "clientProfile": {
      "name": "Jane Client",
      ...
    }
  }
]
```

#### 4. Accept Invitation
```http
POST /invitations/:invitationId/accept
Content-Type: application/json

{
  "freelancerId": "0.0.xxxxx"
}
```

#### 5. Reject Invitation
```http
POST /invitations/:invitationId/reject
Content-Type: application/json

{
  "freelancerId": "0.0.xxxxx"
}
```

---

### Reviews

#### 1. Submit Review
```http
POST /reviews/submit
Content-Type: application/json

{
  "gigRefId": "uuid",
  "reviewerId": "0.0.xxxxx",
  "rating": 5,
  "comment": "Great to work with!" // optional
}
```

**Notes:**
- Only works for completed gigs
- Automatically determines review type based on reviewer
- Each user can only review once per gig

#### 2. Get Reviews for a Gig
```http
GET /reviews/gig/:gigRefId
```

**Response:**
```json
[
  {
    "gigRefId": "...",
    "reviewerId": "0.0.xxxxx",
    "revieweeId": "0.0.yyyyy",
    "rating": 5,
    "comment": "Excellent work!",
    "reviewType": "CLIENT_TO_FREELANCER",
    "reviewerProfile": { ... },
    "revieweeProfile": { ... }
  }
]
```

#### 3. Get User's Reviews
```http
GET /reviews/user/:userAccountId
```

Returns all reviews **received by** the user.

#### 4. Get User's Review Statistics
```http
GET /reviews/user/:userAccountId/stats
```

**Response:**
```json
{
  "totalReviews": 15,
  "averageRating": 4.73,
  "ratingDistribution": {
    "1": 0,
    "2": 0,
    "3": 1,
    "4": 4,
    "5": 10
  },
  "asFreelancer": {
    "count": 10,
    "averageRating": 4.8
  },
  "asClient": {
    "count": 5,
    "averageRating": 4.6
  }
}
```

#### 5. Check if User Reviewed a Gig
```http
GET /reviews/check/:gigRefId/:userId
```

**Response:**
```json
{
  "hasReviewed": true,
  "review": { ... }
}
```

---

## Updated Gig Creation

### Creating a Public Gig (Default)
```http
POST /gigs/prepare-creation
Content-Type: application/json

{
  "clientId": "0.0.xxxxx",
  "title": "Build a Smart Contract",
  "description": "...",
  "budget": 100,
  "duration": "2 weeks",
  "visibility": "PUBLIC" // or omit (defaults to PUBLIC)
}
```

### Creating a Private Gig
```http
POST /gigs/prepare-creation
Content-Type: application/json

{
  "clientId": "0.0.xxxxx",
  "title": "Private Project",
  "description": "...",
  "budget": 100,
  "duration": "2 weeks",
  "visibility": "PRIVATE"
}
```

**Note:** Private gigs will NOT appear in `GET /gigs` (public marketplace).

---

## Complete Workflow Examples

### Public Gig Workflow

```
1. Client creates PUBLIC gig
   POST /gigs/prepare-creation { visibility: "PUBLIC" }

2. Freelancer sees gig in marketplace
   GET /gigs

3. Freelancer applies
   POST /applications/apply

4. Client reviews applications
   GET /applications/gig/:gigRefId?clientId=...

5. Client accepts application
   POST /applications/:applicationId/accept

6. Client assigns gig (existing flow)
   POST /gigs/:gigRefId/prepare-assignment

7. Work is done, escrow released
   POST /gigs/:gigRefId/record-release-escrow

8. Both parties submit reviews
   POST /reviews/submit (client reviews freelancer)
   POST /reviews/submit (freelancer reviews client)
```

### Private Gig Workflow

```
1. Client creates PRIVATE gig
   POST /gigs/prepare-creation { visibility: "PRIVATE" }

2. Client invites specific freelancers
   POST /invitations/send (for each freelancer)

3. Freelancers receive invitations
   GET /invitations/freelancer/:freelancerId

4. Freelancer accepts invitation
   POST /invitations/:invitationId/accept

5. Client assigns gig to accepted freelancer
   POST /gigs/:gigRefId/prepare-assignment

6. Rest follows normal flow...
```

---

## Email Templates Needed

You'll need to create these email templates in `email_system/templates/`:

1. **application_notification.ejs** - Sent to client when freelancer applies
2. **application_accepted.ejs** - Sent to freelancer when application is accepted
3. **invitation_notification.ejs** - Sent to freelancer when invited
4. **invitation_accepted.ejs** - Sent to client when freelancer accepts invitation

---

## Database Indexes

All necessary indexes are created automatically:

### Applications
- `{ gigRefId: 1, freelancerId: 1 }` - Unique, prevents duplicate applications
- `{ gigRefId: 1, status: 1 }` - Fast filtering by status

### Invitations
- `{ gigRefId: 1, freelancerId: 1 }` - Unique, prevents duplicate invitations

### Reviews
- `{ gigRefId: 1, reviewerId: 1 }` - Unique, prevents duplicate reviews
- `{ revieweeId: 1 }` - Fast lookup of user's received reviews

### Gigs
- `{ visibility: 1, status: 1 }` - Fast filtering of public/private gigs

---

## Migration Notes

### Existing Gigs
All existing gigs will default to `visibility: "PUBLIC"` during HCS sync for backward compatibility.

### No Breaking Changes
All existing endpoints continue to work. The new features are additive.

---

## Testing Checklist

### Applications
- [ ] Freelancer can apply to public gig
- [ ] Cannot apply to private gig without invitation
- [ ] Cannot apply twice to same gig
- [ ] Client can see all applications
- [ ] Client can accept application (others auto-rejected)
- [ ] Email notifications work

### Invitations
- [ ] Client can invite freelancers to private gig
- [ ] Cannot invite to public gig
- [ ] Cannot send duplicate invitations
- [ ] Freelancer receives invitation
- [ ] Freelancer can accept/reject
- [ ] Email notifications work

### Reviews
- [ ] Can only review completed gigs
- [ ] Both parties can review
- [ ] Cannot review twice
- [ ] Review stats calculate correctly
- [ ] Reviews display on user profile

### Gig Visibility
- [ ] Public gigs appear in marketplace
- [ ] Private gigs do NOT appear in marketplace
- [ ] Private gigs visible to client in dashboard
- [ ] Existing gigs default to PUBLIC

---

### Freelancers

#### 1. Browse Freelancers
```http
GET /freelancers/browse?skills=Solidity,React&minRating=4&sortBy=rating&limit=20&page=1
```

**Query Parameters:**
- `skills` - Comma-separated skills
- `minRating` - Minimum average rating (1-5)
- `minXP` - Minimum XP points
- `search` - Search in name or skills
- `sortBy` - `rating`, `xp`, or `recent`
- `limit` - Results per page (max 100)
- `page` - Page number

**Response:**
```json
{
  "freelancers": [
    {
      "userAccountId": "0.0.12345",
      "name": "John Doe",
      "skills": ["Solidity", "React"],
      "stats": {
        "averageRating": 4.85,
        "totalReviews": 23,
        "xpPoints": 2300,
        "completedGigs": 23
      }
    }
  ],
  "pagination": {
    "total": 45,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

#### 2. Get Freelancer Profile
```http
GET /freelancers/:userAccountId
```

Returns detailed profile with stats, completed gigs, and recent reviews.

#### 3. Get Skills List
```http
GET /freelancers/skills/list
```

Returns all unique skills with frequency counts (useful for autocomplete).

#### 4. Get Top-Rated Freelancers
```http
GET /freelancers/top/rated?limit=10
```

---

## Future Enhancements

Consider adding:
1. **Proposal system** - More detailed proposals beyond cover letter
2. **Milestone-based payments** - Split escrow into milestones
3. **Dispute resolution** - Structured dispute process with evidence
4. **Freelancer search** - Search/filter freelancers by skills, rating
5. **Portfolio showcase** - Rich media portfolios
6. **Messaging system** - Real-time chat between parties
7. **Notification preferences** - User control over email notifications
8. **Review responses** - Allow users to respond to reviews
