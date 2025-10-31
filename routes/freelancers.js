import express from 'express';
import { Profile, Gig, Review, XP } from '../db/models.js';

const router = express.Router();

// =================================================================
// --- FREELANCER BROWSING & SEARCH ENDPOINTS ---
// =================================================================

/**
 * GET /freelancers/browse
 * Browse all freelancers with optional filters
 * Query params:
 *   - skills: comma-separated skills (e.g., "Solidity,React")
 *   - minRating: minimum average rating (1-5)
 *   - minXP: minimum XP points
 *   - search: search in name or skills
 *   - sortBy: 'rating' | 'xp' | 'recent' (default: 'rating')
 *   - limit: number of results (default: 20, max: 100)
 *   - page: page number (default: 1)
 */
router.get('/browse', async (req, res) => {
    try {
        const {
            skills,
            minRating,
            minXP,
            search,
            sortBy = 'rating',
            limit = 20,
            page = 1
        } = req.query;

        // Build query
        let query = {
            profileType: "freelancer"
        };

        // Search by name or skills
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { skills: { $regex: search, $options: 'i' } }
            ];
        }

        // Filter by skills (match any of the provided skills)
        if (skills) {
            const skillsArray = skills.split(',').map(s => s.trim());
            query.skills = { $in: skillsArray.map(skill => new RegExp(skill, 'i')) };
        }

        // Get all profiles matching the query
        const profiles = await Profile.find(query)
            .select('-type') // Exclude internal fields
            .lean();

        // Enrich profiles with stats
        const enrichedProfiles = await Promise.all(
            profiles.map(async (profile) => {
                // Get review stats
                const reviews = await Review.find({ revieweeId: profile.userAccountId });
                const freelancerReviews = reviews.filter(r => r.reviewType === 'CLIENT_TO_FREELANCER');

                const totalReviews = freelancerReviews.length;
                const averageRating = totalReviews > 0
                    ? freelancerReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
                    : 0;

                // Get XP
                const xpRecord = await XP.findOne({ userAccountId: profile.userAccountId });
                const xpPoints = xpRecord?.xpPoints || 0;

                // Get completed gigs count
                const completedGigs = await Gig.countDocuments({
                    assignedFreelancerId: profile.userAccountId,
                    status: { $in: ['COMPLETED', 'COMPLETED_BY_ARBITER'] }
                });

                return {
                    ...profile,
                    stats: {
                        averageRating: parseFloat(averageRating.toFixed(2)),
                        totalReviews,
                        xpPoints,
                        completedGigs
                    }
                };
            })
        );

        // Apply filters based on stats
        let filteredProfiles = enrichedProfiles;

        if (minRating) {
            const minRatingNum = parseFloat(minRating);
            filteredProfiles = filteredProfiles.filter(p => p.stats.averageRating >= minRatingNum);
        }

        if (minXP) {
            const minXPNum = parseInt(minXP);
            filteredProfiles = filteredProfiles.filter(p => p.stats.xpPoints >= minXPNum);
        }

        // Sort profiles
        filteredProfiles.sort((a, b) => {
            switch (sortBy) {
                case 'rating':
                    return b.stats.averageRating - a.stats.averageRating;
                case 'xp':
                    return b.stats.xpPoints - a.stats.xpPoints;
                case 'recent':
                    return new Date(b.createdAt) - new Date(a.createdAt);
                default:
                    return b.stats.averageRating - a.stats.averageRating;
            }
        });

        // Pagination
        const limitNum = Math.min(parseInt(limit), 100);
        const pageNum = parseInt(page);
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;

        const paginatedProfiles = filteredProfiles.slice(startIndex, endIndex);

        res.status(200).json({
            freelancers: paginatedProfiles,
            pagination: {
                total: filteredProfiles.length,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(filteredProfiles.length / limitNum)
            }
        });
    } catch (error) {
        console.error('Error browsing freelancers:', error);
        res.status(500).json({ message: 'Error browsing freelancers', error: error.toString() });
    }
});

/**
 * GET /freelancers/:userAccountId
 * Get detailed freelancer profile with full stats
 */
router.get('/:userAccountId', async (req, res) => {
    try {
        const { userAccountId } = req.params;

        // Get profile
        const profile = await Profile.findOne({ userAccountId });
        if (!profile) {
            return res.status(404).json({ message: 'Freelancer not found.' });
        }

        // Get review stats
        const reviews = await Review.find({ revieweeId: userAccountId });
        const freelancerReviews = reviews.filter(r => r.reviewType === 'CLIENT_TO_FREELANCER');

        const totalReviews = freelancerReviews.length;
        const averageRating = totalReviews > 0
            ? freelancerReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
            : 0;

        // Rating distribution
        const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        freelancerReviews.forEach(review => {
            ratingDistribution[review.rating]++;
        });

        // Get XP
        const xpRecord = await XP.findOne({ userAccountId });
        const xpPoints = xpRecord?.xpPoints || 0;

        // Get completed gigs
        const completedGigs = await Gig.find({
            assignedFreelancerId: userAccountId,
            status: { $in: ['COMPLETED', 'COMPLETED_BY_ARBITER'] }
        }).select('title budget clientId createdAt');

        const activeGigs = await Gig.find({
            assignedFreelancerId: userAccountId,
            status: "IN_PROGRESS"
        }).select('title budget clientId createdAt');

        // Get recent reviews with reviewer details
        const recentReviews = await Promise.all(
            freelancerReviews.slice(0, 5).map(async (review) => {
                const reviewer = await Profile.findOne({ userAccountId: review.reviewerId });
                const gig = await Gig.findOne({ gigRefId: review.gigRefId });
                return {
                    ...review.toObject(),
                    reviewerProfile: reviewer,
                    gig
                };
            })
        );

        res.status(200).json({
            profile: profile.toObject(),
            stats: {
                averageRating: parseFloat(averageRating.toFixed(2)),
                totalReviews,
                ratingDistribution,
                xpPoints,
                activeGigsCount: activeGigs.length,
                completedGigsCount: completedGigs.length,
                totalEarned: completedGigs.reduce((sum, gig) => sum + Number(gig.budget.split("HBAR")[0]), 0)
            },
            completedGigs,
            recentReviews
        });
    } catch (error) {
        console.error('Error fetching freelancer profile:', error);
        res.status(500).json({ message: 'Error fetching freelancer profile', error: error.toString() });
    }
});

/**
 * GET /freelancers/skills/list
 * Get list of all unique skills from all freelancers
 * Useful for autocomplete/filter dropdowns
 */
router.get('/skills/list', async (req, res) => {
    try {
        // Get all profiles
        const profiles = await Profile.find({}).select('skills');

        // Extract and flatten all skills
        const allSkills = profiles.reduce((acc, profile) => {
            if (Array.isArray(profile.skills)) {
                return [...acc, ...profile.skills];
            } else if (typeof profile.skills === 'string') {
                // Handle comma-separated string format
                return [...acc, ...profile.skills.split(',').map(s => s.trim())];
            }
            return acc;
        }, []);

        // Get unique skills and count occurrences
        const skillCounts = allSkills.reduce((acc, skill) => {
            const normalizedSkill = skill.trim();
            if (normalizedSkill) {
                acc[normalizedSkill] = (acc[normalizedSkill] || 0) + 1;
            }
            return acc;
        }, {});

        // Convert to array and sort by frequency
        const skillsList = Object.entries(skillCounts)
            .map(([skill, count]) => ({ skill, count }))
            .sort((a, b) => b.count - a.count);

        res.status(200).json({
            skills: skillsList,
            totalUniqueSkills: skillsList.length
        });
    } catch (error) {
        console.error('Error fetching skills list:', error);
        res.status(500).json({ message: 'Error fetching skills list', error: error.toString() });
    }
});

/**
 * GET /freelancers/top/rated
 * Get top-rated freelancers
 */
router.get('/top/rated', async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        // Get all profiles
        const profiles = await Profile.find({}).lean();

        // Enrich with ratings
        const profilesWithRatings = await Promise.all(
            profiles.map(async (profile) => {
                const reviews = await Review.find({
                    revieweeId: profile.userAccountId,
                    reviewType: 'CLIENT_TO_FREELANCER'
                });

                if (reviews.length === 0) return null;

                const averageRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
                const completedGigs = await Gig.countDocuments({
                    assignedFreelancerId: profile.userAccountId,
                    status: { $in: ['COMPLETED', 'COMPLETED_BY_ARBITER'] }
                });

                return {
                    ...profile,
                    stats: {
                        averageRating: parseFloat(averageRating.toFixed(2)),
                        totalReviews: reviews.length,
                        completedGigs
                    }
                };
            })
        );

        // Filter out profiles without reviews and sort by rating
        const topRated = profilesWithRatings
            .filter(p => p !== null)
            .sort((a, b) => {
                // Sort by rating, then by number of reviews
                if (b.stats.averageRating !== a.stats.averageRating) {
                    return b.stats.averageRating - a.stats.averageRating;
                }
                return b.stats.totalReviews - a.stats.totalReviews;
            })
            .slice(0, parseInt(limit));

        res.status(200).json(topRated);
    } catch (error) {
        console.error('Error fetching top rated freelancers:', error);
        res.status(500).json({ message: 'Error fetching top rated freelancers', error: error.toString() });
    }
});

export default router;
