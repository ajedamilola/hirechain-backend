# Freelancer Search & Browse Feature

## Overview

Clients can now browse and search for freelancers based on skills, ratings, experience, and more. This feature helps clients find the perfect freelancer for their private gigs or to review before accepting applications.

## Features

✅ **Browse all freelancers** with pagination  
✅ **Search by name or skills**  
✅ **Filter by specific skills** (comma-separated)  
✅ **Filter by minimum rating**  
✅ **Filter by minimum XP**  
✅ **Sort by rating, XP, or recent**  
✅ **View detailed freelancer profiles** with stats  
✅ **Get list of all available skills** (for autocomplete)  
✅ **Top-rated freelancers** leaderboard  

---

## API Endpoints

### 1. Browse Freelancers

```http
GET /freelancers/browse
```

**Query Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `skills` | string | Comma-separated skills to filter by | `Solidity,React,Node.js` |
| `minRating` | number | Minimum average rating (1-5) | `4.5` |
| `minXP` | number | Minimum XP points | `500` |
| `search` | string | Search in name or skills | `John` |
| `sortBy` | string | Sort order: `rating`, `xp`, or `recent` | `rating` |
| `limit` | number | Results per page (max 100) | `20` |
| `page` | number | Page number | `1` |

**Example Request:**

```bash
# Browse all freelancers
curl "http://localhost:3000/freelancers/browse"

# Search for Solidity developers with 4+ rating
curl "http://localhost:3000/freelancers/browse?skills=Solidity&minRating=4"

# Search by name
curl "http://localhost:3000/freelancers/browse?search=John"

# Multiple skills with pagination
curl "http://localhost:3000/freelancers/browse?skills=React,TypeScript&limit=10&page=2"

# Filter by XP and sort
curl "http://localhost:3000/freelancers/browse?minXP=1000&sortBy=xp"
```

**Response:**

```json
{
  "freelancers": [
    {
      "userAccountId": "0.0.12345",
      "name": "John Doe",
      "skills": ["Solidity", "React", "Node.js"],
      "portfolioUrl": "https://johndoe.com",
      "email": "john@example.com",
      "createdAt": "2025-01-15T10:00:00.000Z",
      "stats": {
        "averageRating": 4.85,
        "totalReviews": 23,
        "xpPoints": 2300,
        "completedGigs": 23
      }
    },
    {
      "userAccountId": "0.0.67890",
      "name": "Jane Smith",
      "skills": ["Solidity", "Web3", "Smart Contracts"],
      "portfolioUrl": "https://janesmith.dev",
      "email": "jane@example.com",
      "createdAt": "2025-01-10T08:30:00.000Z",
      "stats": {
        "averageRating": 4.92,
        "totalReviews": 18,
        "xpPoints": 1800,
        "completedGigs": 18
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

---

### 2. Get Detailed Freelancer Profile

```http
GET /freelancers/:userAccountId
```

**Example Request:**

```bash
curl "http://localhost:3000/freelancers/0.0.12345"
```

**Response:**

```json
{
  "profile": {
    "userAccountId": "0.0.12345",
    "name": "John Doe",
    "skills": ["Solidity", "React", "Node.js"],
    "portfolioUrl": "https://johndoe.com",
    "email": "john@example.com",
    "createdAt": "2025-01-15T10:00:00.000Z"
  },
  "stats": {
    "averageRating": 4.85,
    "totalReviews": 23,
    "ratingDistribution": {
      "1": 0,
      "2": 0,
      "3": 1,
      "4": 5,
      "5": 17
    },
    "xpPoints": 2300,
    "completedGigsCount": 23
  },
  "completedGigs": [
    {
      "_id": "...",
      "title": "Build DeFi Protocol",
      "budget": "500 HBAR",
      "clientId": "0.0.99999",
      "createdAt": "2025-01-20T12:00:00.000Z"
    }
  ],
  "recentReviews": [
    {
      "gigRefId": "...",
      "reviewerId": "0.0.99999",
      "rating": 5,
      "comment": "Excellent work, highly professional!",
      "reviewerProfile": {
        "name": "Client Name",
        "userAccountId": "0.0.99999"
      },
      "gig": {
        "title": "Build DeFi Protocol"
      }
    }
  ]
}
```

---

### 3. Get All Skills List

Useful for building autocomplete dropdowns or filter UI.

```http
GET /freelancers/skills/list
```

**Example Request:**

```bash
curl "http://localhost:3000/freelancers/skills/list"
```

**Response:**

```json
{
  "skills": [
    {
      "skill": "Solidity",
      "count": 45
    },
    {
      "skill": "React",
      "count": 38
    },
    {
      "skill": "Node.js",
      "count": 32
    },
    {
      "skill": "Web3",
      "count": 28
    },
    {
      "skill": "Smart Contracts",
      "count": 25
    }
  ],
  "totalUniqueSkills": 87
}
```

---

### 4. Get Top-Rated Freelancers

```http
GET /freelancers/top/rated
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | number | Number of top freelancers to return | `10` |

**Example Request:**

```bash
curl "http://localhost:3000/freelancers/top/rated?limit=5"
```

**Response:**

```json
[
  {
    "userAccountId": "0.0.12345",
    "name": "John Doe",
    "skills": ["Solidity", "React"],
    "portfolioUrl": "https://johndoe.com",
    "stats": {
      "averageRating": 4.95,
      "totalReviews": 40,
      "completedGigs": 40
    }
  },
  {
    "userAccountId": "0.0.67890",
    "name": "Jane Smith",
    "skills": ["Solidity", "Web3"],
    "portfolioUrl": "https://janesmith.dev",
    "stats": {
      "averageRating": 4.92,
      "totalReviews": 35,
      "completedGigs": 35
    }
  }
]
```

---

## Use Cases

### 1. Browse Freelancers for Private Gig

```javascript
// Client wants to create a private gig and invite Solidity developers
const response = await fetch(
  'http://localhost:3000/freelancers/browse?skills=Solidity&minRating=4&sortBy=rating'
);
const { freelancers } = await response.json();

// Display freelancers to client
// Client selects freelancers to invite
// Send invitations using /invitations/send
```

### 2. Search for Specific Freelancer

```javascript
// Client remembers working with "John" before
const response = await fetch(
  'http://localhost:3000/freelancers/browse?search=John'
);
const { freelancers } = await response.json();

// Display matching freelancers
```

### 3. Build Skill Filter Dropdown

```javascript
// Get all available skills for autocomplete
const response = await fetch('http://localhost:3000/freelancers/skills/list');
const { skills } = await response.json();

// Use skills array to populate dropdown/autocomplete
// skills = [{ skill: "Solidity", count: 45 }, ...]
```

### 4. View Freelancer Before Accepting Application

```javascript
// Client receives application from freelancer
const freelancerId = application.freelancerId;

// View detailed profile
const response = await fetch(`http://localhost:3000/freelancers/${freelancerId}`);
const { profile, stats, recentReviews } = await response.json();

// Display profile, ratings, past work, reviews
// Client makes informed decision
```

### 5. Show Top Freelancers on Homepage

```javascript
// Display top-rated freelancers on landing page
const response = await fetch('http://localhost:3000/freelancers/top/rated?limit=5');
const topFreelancers = await response.json();

// Showcase top talent
```

---

## Frontend Implementation Examples

### React Component - Freelancer Browse

```jsx
import { useState, useEffect } from 'react';

function FreelancerBrowser() {
  const [freelancers, setFreelancers] = useState([]);
  const [filters, setFilters] = useState({
    skills: '',
    minRating: '',
    search: '',
    sortBy: 'rating'
  });

  const searchFreelancers = async () => {
    const params = new URLSearchParams();
    if (filters.skills) params.append('skills', filters.skills);
    if (filters.minRating) params.append('minRating', filters.minRating);
    if (filters.search) params.append('search', filters.search);
    params.append('sortBy', filters.sortBy);

    const response = await fetch(`/freelancers/browse?${params}`);
    const data = await response.json();
    setFreelancers(data.freelancers);
  };

  return (
    <div>
      <input
        placeholder="Search by name..."
        value={filters.search}
        onChange={(e) => setFilters({ ...filters, search: e.target.value })}
      />
      <input
        placeholder="Skills (e.g., Solidity,React)"
        value={filters.skills}
        onChange={(e) => setFilters({ ...filters, skills: e.target.value })}
      />
      <select
        value={filters.sortBy}
        onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
      >
        <option value="rating">Sort by Rating</option>
        <option value="xp">Sort by XP</option>
        <option value="recent">Sort by Recent</option>
      </select>
      <button onClick={searchFreelancers}>Search</button>

      <div>
        {freelancers.map(freelancer => (
          <div key={freelancer.userAccountId}>
            <h3>{freelancer.name}</h3>
            <p>Skills: {freelancer.skills.join(', ')}</p>
            <p>Rating: {freelancer.stats.averageRating} ⭐ ({freelancer.stats.totalReviews} reviews)</p>
            <p>Completed Gigs: {freelancer.stats.completedGigs}</p>
            <p>XP: {freelancer.stats.xpPoints}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Performance Notes

### Indexes

The following indexes are already in place for optimal performance:

- `Profile.userAccountId` - Fast profile lookups
- `Review.revieweeId` - Fast review queries
- `Gig.assignedFreelancerId` - Fast gig counting

### Caching Recommendations

For production, consider caching:

1. **Skills list** - Changes infrequently, cache for 1 hour
2. **Top-rated freelancers** - Cache for 15 minutes
3. **Freelancer stats** - Cache per user for 5 minutes

Example with Redis:

```javascript
// Cache skills list
const cachedSkills = await redis.get('skills:list');
if (cachedSkills) {
  return JSON.parse(cachedSkills);
}

const skills = await getSkillsList();
await redis.setex('skills:list', 3600, JSON.stringify(skills));
```

---

## Filtering Logic

### Skill Matching

Skills are matched using case-insensitive regex:

```javascript
// Matches "solidity", "Solidity", "SOLIDITY"
skills: { $in: skillsArray.map(skill => new RegExp(skill, 'i')) }
```

### Search

Search looks in both name and skills:

```javascript
$or: [
  { name: { $regex: search, $options: 'i' } },
  { skills: { $regex: search, $options: 'i' } }
]
```

### Stats Calculation

Stats are calculated in real-time by:
1. Fetching all reviews where user is reviewee
2. Filtering for CLIENT_TO_FREELANCER reviews only
3. Calculating average, distribution, etc.

---

## Integration with Existing Features

### With Private Gigs

```
1. Client creates PRIVATE gig
2. Client browses freelancers with specific skills
   GET /freelancers/browse?skills=Solidity&minRating=4
3. Client views detailed profiles
   GET /freelancers/:userAccountId
4. Client sends invitations
   POST /invitations/send
```

### With Applications

```
1. Freelancer applies to PUBLIC gig
2. Client receives notification
3. Client views freelancer profile before accepting
   GET /freelancers/:freelancerId
4. Client reviews stats, past work, reviews
5. Client accepts or rejects application
```

---

## Testing

```bash
# Test basic browse
curl "http://localhost:3000/freelancers/browse"

# Test skill filter
curl "http://localhost:3000/freelancers/browse?skills=Solidity,React"

# Test search
curl "http://localhost:3000/freelancers/browse?search=John"

# Test rating filter
curl "http://localhost:3000/freelancers/browse?minRating=4.5"

# Test pagination
curl "http://localhost:3000/freelancers/browse?limit=5&page=2"

# Test detailed profile
curl "http://localhost:3000/freelancers/0.0.12345"

# Test skills list
curl "http://localhost:3000/freelancers/skills/list"

# Test top rated
curl "http://localhost:3000/freelancers/top/rated?limit=10"
```

---

## Future Enhancements

Consider adding:

1. **Advanced filters**:
   - Availability status
   - Hourly rate range
   - Location/timezone
   - Languages spoken

2. **Saved searches**: Save filter combinations

3. **Freelancer recommendations**: ML-based matching

4. **Verification badges**: Verified skills, identity

5. **Response time stats**: Average response time

6. **Success rate**: Percentage of successfully completed gigs

7. **Specializations**: Categories like "DeFi Expert", "NFT Specialist"

---

## Summary

The freelancer search feature provides:

✅ **Comprehensive search** with multiple filters  
✅ **Detailed profiles** with stats and reviews  
✅ **Skill-based discovery** for targeted hiring  
✅ **Top talent showcase** for platform credibility  
✅ **Seamless integration** with private gigs and applications  

This completes the hiring workflow, allowing clients to:
- Browse and discover talent
- Create public gigs (open applications)
- Create private gigs (invite specific freelancers)
- Review applications with full context
- Make informed hiring decisions
