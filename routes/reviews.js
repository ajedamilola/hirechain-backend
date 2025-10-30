import express from 'express';
import { Review, Gig, Profile } from '../db/models.js';

const router = express.Router();

// =================================================================
// --- REVIEW ENDPOINTS ---
// =================================================================

/**
 * POST /reviews/submit
 * Submit a review after gig completion
 */
router.post('/submit', async (req, res) => {
    try {
        const { gigRefId, reviewerId, rating, comment } = req.body;

        if (!gigRefId || !reviewerId || !rating) {
            return res.status(400).json({ message: 'gigRefId, reviewerId, and rating are required.' });
        }

        if (rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
        }

        // Validate gig exists and is completed
        const gig = await Gig.findOne({ gigRefId });
        if (!gig) {
            return res.status(404).json({ message: 'Gig not found.' });
        }

        if (gig.status !== 'COMPLETED' && gig.status !== 'COMPLETED_BY_ARBITER') {
            return res.status(403).json({ message: 'Reviews can only be submitted for completed gigs.' });
        }

        // Determine reviewer type and reviewee
        let reviewType;
        let revieweeId;

        if (reviewerId === gig.clientId) {
            // Client reviewing freelancer
            reviewType = 'CLIENT_TO_FREELANCER';
            revieweeId = gig.assignedFreelancerId;
        } else if (reviewerId === gig.assignedFreelancerId) {
            // Freelancer reviewing client
            reviewType = 'FREELANCER_TO_CLIENT';
            revieweeId = gig.clientId;
        } else {
            return res.status(403).json({ message: 'Only participants of this gig can submit reviews.' });
        }

        // Check if review already exists
        const existingReview = await Review.findOne({ gigRefId, reviewerId });
        if (existingReview) {
            return res.status(409).json({ message: 'You have already reviewed this gig.' });
        }

        // Create review
        const review = await Review.create({
            gigRefId,
            reviewerId,
            //self review for quick debugging
            revieweeId: revieweeId || reviewerId,
            rating,
            comment,
            reviewType
        });

        res.status(201).json({
            message: 'Review submitted successfully.',
            review
        });
    } catch (error) {
        console.error('Error submitting review:', error);
        res.status(500).json({ message: 'Error submitting review', error: error.toString() });
    }
});

/**
 * GET /reviews/gig/:gigRefId
 * Get all reviews for a specific gig
 */
router.get('/gig/:gigRefId', async (req, res) => {
    try {
        const { gigRefId } = req.params;

        const reviews = await Review.find({ gigRefId }).sort({ createdAt: -1 });

        // Enrich with reviewer profiles
        const enrichedReviews = await Promise.all(
            reviews.map(async (review) => {
                const reviewer = await Profile.findOne({ userAccountId: review.reviewerId });
                const reviewee = await Profile.findOne({ userAccountId: review.revieweeId });
                return {
                    ...review.toObject(),
                    reviewerProfile: reviewer,
                    revieweeProfile: reviewee
                };
            })
        );

        res.status(200).json(enrichedReviews);
    } catch (error) {
        console.error('Error fetching gig reviews:', error);
        res.status(500).json({ message: 'Error fetching reviews', error: error.toString() });
    }
});

/**
 * GET /reviews/user/:userAccountId
 * Get all reviews received by a user (for their profile)
 */
router.get('/user/:userAccountId', async (req, res) => {
    try {
        const { userAccountId } = req.params;

        const reviews = await Review.find({ revieweeId: userAccountId }).sort({ createdAt: -1 });

        // Enrich with reviewer profiles and gig details
        const enrichedReviews = await Promise.all(
            reviews.map(async (review) => {
                const reviewer = await Profile.findOne({ userAccountId: review.reviewerId });
                const gig = await Gig.findOne({ gigRefId: review.gigRefId });
                return {
                    ...review.toObject(),
                    reviewerProfile: reviewer,
                    gig
                };
            })
        );

        res.status(200).json(enrichedReviews);
    } catch (error) {
        console.error('Error fetching user reviews:', error);
        res.status(500).json({ message: 'Error fetching reviews', error: error.toString() });
    }
});

/**
 * GET /reviews/user/:userAccountId/stats
 * Get review statistics for a user (average rating, total reviews)
 */
router.get('/user/:userAccountId/stats', async (req, res) => {
    try {
        const { userAccountId } = req.params;

        const reviews = await Review.find({ revieweeId: userAccountId });

        if (reviews.length === 0) {
            return res.status(200).json({
                totalReviews: 0,
                averageRating: 0,
                ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
            });
        }

        // Calculate statistics
        const totalReviews = reviews.length;
        const sumRatings = reviews.reduce((sum, review) => sum + review.rating, 0);
        const averageRating = (sumRatings / totalReviews).toFixed(2);

        // Rating distribution
        const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        reviews.forEach(review => {
            ratingDistribution[review.rating]++;
        });

        // Separate stats by review type
        const clientReviews = reviews.filter(r => r.reviewType === 'CLIENT_TO_FREELANCER');
        const freelancerReviews = reviews.filter(r => r.reviewType === 'FREELANCER_TO_CLIENT');

        res.status(200).json({
            totalReviews,
            averageRating: parseFloat(averageRating),
            ratingDistribution,
            asFreelancer: {
                count: clientReviews.length,
                averageRating: clientReviews.length > 0
                    ? (clientReviews.reduce((sum, r) => sum + r.rating, 0) / clientReviews.length).toFixed(2)
                    : 0
            },
            asClient: {
                count: freelancerReviews.length,
                averageRating: freelancerReviews.length > 0
                    ? (freelancerReviews.reduce((sum, r) => sum + r.rating, 0) / freelancerReviews.length).toFixed(2)
                    : 0
            }
        });
    } catch (error) {
        console.error('Error fetching user review stats:', error);
        res.status(500).json({ message: 'Error fetching review stats', error: error.toString() });
    }
});

/**
 * GET /reviews/check/:gigRefId/:userId
 * Check if a user has already reviewed a gig
 */
router.get('/check/:gigRefId/:userId', async (req, res) => {
    try {
        const { gigRefId, userId } = req.params;

        const review = await Review.findOne({ gigRefId, reviewerId: userId });

        res.status(200).json({
            hasReviewed: !!review,
            review: review || null
        });
    } catch (error) {
        console.error('Error checking review status:', error);
        res.status(500).json({ message: 'Error checking review status', error: error.toString() });
    }
});

export default router;
