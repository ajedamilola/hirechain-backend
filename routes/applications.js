import express from 'express';
import { Application, Gig, Profile } from '../db/models.js';
import { sendEmail } from '../email_system/email_config.js';

const router = express.Router();

// =================================================================
// --- APPLICATION ENDPOINTS (For Public Gigs) ---
// =================================================================

/**
 * POST /applications/apply
 * Freelancer applies to a public gig
 */
router.post('/apply', async (req, res) => {
    try {
        const { gigRefId, freelancerId, coverLetter, proposedRate } = req.body;

        if (!gigRefId || !freelancerId || !coverLetter) {
            return res.status(400).json({ message: 'gigRefId, freelancerId, and coverLetter are required.' });
        }

        // Validate gig exists and is public and open
        const gig = await Gig.findOne({ gigRefId });
        if (!gig) {
            return res.status(404).json({ message: 'Gig not found.' });
        }

        if (gig.visibility !== 'PUBLIC') {
            return res.status(403).json({ message: 'This is a private gig. You must be invited to apply.' });
        }

        if (gig.status !== 'OPEN') {
            return res.status(403).json({ message: 'This gig is no longer accepting applications.' });
        }

        // Check if freelancer already applied
        const existingApplication = await Application.findOne({ gigRefId, freelancerId });
        if (existingApplication) {
            return res.status(409).json({ message: 'You have already applied to this gig.' });
        }

        // Create application
        const application = await Application.create({
            gigRefId,
            freelancerId,
            coverLetter,
            proposedRate,
            status: 'PENDING'
        });

        // Send email notification to client
        const client = await Profile.findOne({ userAccountId: gig.clientId });
        const freelancer = await Profile.findOne({ userAccountId: freelancerId });
        
        if (client && freelancer) {
            await sendEmail({
                to: client.email,
                subject: `New Application for "${gig.title}"`,
                template: 'application_notification.ejs',
                data: {
                    clientName: client.name,
                    freelancerName: freelancer.name,
                    gigTitle: gig.title,
                    gigRefId,
                    coverLetter,
                    actionUrl: `https://frontendurl/gigs/${gigRefId}/applications`
                }
            }).catch(err => console.error('Email error:', err));
        }

        res.status(201).json({ 
            message: 'Application submitted successfully.',
            application 
        });
    } catch (error) {
        console.error('Error submitting application:', error);
        res.status(500).json({ message: 'Error submitting application', error: error.toString() });
    }
});

/**
 * GET /applications/gig/:gigRefId
 * Get all applications for a specific gig (client only)
 */
router.get('/gig/:gigRefId', async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const { clientId } = req.query;

        if (!clientId) {
            return res.status(400).json({ message: 'clientId query parameter is required.' });
        }

        // Verify the requester is the gig owner
        const gig = await Gig.findOne({ gigRefId });
        if (!gig) {
            return res.status(404).json({ message: 'Gig not found.' });
        }

        if (gig.clientId !== clientId) {
            return res.status(403).json({ message: 'Only the gig owner can view applications.' });
        }

        // Get all applications with freelancer details
        const applications = await Application.find({ gigRefId }).sort({ appliedAt: -1 });
        
        // Enrich with freelancer profiles
        const enrichedApplications = await Promise.all(
            applications.map(async (app) => {
                const freelancer = await Profile.findOne({ userAccountId: app.freelancerId });
                return {
                    ...app.toObject(),
                    freelancerProfile: freelancer
                };
            })
        );

        res.status(200).json(enrichedApplications);
    } catch (error) {
        console.error('Error fetching applications:', error);
        res.status(500).json({ message: 'Error fetching applications', error: error.toString() });
    }
});

/**
 * GET /applications/freelancer/:freelancerId
 * Get all applications by a specific freelancer
 */
router.get('/freelancer/:freelancerId', async (req, res) => {
    try {
        const { freelancerId } = req.params;

        const applications = await Application.find({ freelancerId }).sort({ appliedAt: -1 });
        
        // Enrich with gig details
        const enrichedApplications = await Promise.all(
            applications.map(async (app) => {
                const gig = await Gig.findOne({ gigRefId: app.gigRefId });
                return {
                    ...app.toObject(),
                    gig
                };
            })
        );

        res.status(200).json(enrichedApplications);
    } catch (error) {
        console.error('Error fetching freelancer applications:', error);
        res.status(500).json({ message: 'Error fetching applications', error: error.toString() });
    }
});

/**
 * POST /applications/:applicationId/accept
 * Client accepts an application (this triggers gig assignment flow)
 */
router.post('/:applicationId/accept', async (req, res) => {
    try {
        const { applicationId } = req.params;
        const { clientId } = req.body;

        const application = await Application.findById(applicationId);
        if (!application) {
            return res.status(404).json({ message: 'Application not found.' });
        }

        // Verify the requester is the gig owner
        const gig = await Gig.findOne({ gigRefId: application.gigRefId });
        if (!gig || gig.clientId !== clientId) {
            return res.status(403).json({ message: 'Only the gig owner can accept applications.' });
        }

        if (gig.status !== 'OPEN') {
            return res.status(403).json({ message: 'This gig is no longer open.' });
        }

        // Update application status
        application.status = 'ACCEPTED';
        await application.save();

        // Reject all other pending applications
        await Application.updateMany(
            { gigRefId: application.gigRefId, _id: { $ne: applicationId }, status: 'PENDING' },
            { status: 'REJECTED' }
        );

        // Send notification to accepted freelancer
        const freelancer = await Profile.findOne({ userAccountId: application.freelancerId });
        if (freelancer) {
            await sendEmail({
                to: freelancer.email,
                subject: `Your application for "${gig.title}" was accepted!`,
                template: 'application_accepted.ejs',
                data: {
                    freelancerName: freelancer.name,
                    gigTitle: gig.title,
                    gigRefId: gig.gigRefId,
                    actionUrl: `https://frontendurl/gigs/${gig.gigRefId}`
                }
            }).catch(err => console.error('Email error:', err));
        }

        res.status(200).json({ 
            message: 'Application accepted. Proceed with gig assignment.',
            freelancerId: application.freelancerId
        });
    } catch (error) {
        console.error('Error accepting application:', error);
        res.status(500).json({ message: 'Error accepting application', error: error.toString() });
    }
});

/**
 * POST /applications/:applicationId/reject
 * Client rejects an application
 */
router.post('/:applicationId/reject', async (req, res) => {
    try {
        const { applicationId } = req.params;
        const { clientId } = req.body;

        const application = await Application.findById(applicationId);
        if (!application) {
            return res.status(404).json({ message: 'Application not found.' });
        }

        // Verify the requester is the gig owner
        const gig = await Gig.findOne({ gigRefId: application.gigRefId });
        if (!gig || gig.clientId !== clientId) {
            return res.status(403).json({ message: 'Only the gig owner can reject applications.' });
        }

        // Update application status
        application.status = 'REJECTED';
        await application.save();

        res.status(200).json({ message: 'Application rejected.' });
    } catch (error) {
        console.error('Error rejecting application:', error);
        res.status(500).json({ message: 'Error rejecting application', error: error.toString() });
    }
});

export default router;
